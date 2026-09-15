import { corsHeaders,authenticate,json,requireAdmin,serviceClient } from "../_shared/security.ts";
const factor:Record<string,number>={NGN:100,GHS:100,USD:100,GBP:100,EUR:100};
Deno.serve(async(request)=>{
  if(request.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
  try{
    const {user}=await authenticate(request);await requireAdmin(user.id);
    const {paymentId}=await request.json();const service=serviceClient();
    const {data:payment,error}=await service.rpc("claim_reviewer_payment",{p_payment_id:paymentId,p_admin_id:user.id});
    if(error||!payment)return json({error:error?.message||"Reviewer payment is unavailable"},409);
    const url=Deno.env.get("PAYMENTS_PROVIDER_PAYOUT_URL"),key=Deno.env.get("PAYMENTS_PROVIDER_API_KEY");
    if(!url||!key)return json({error:"Payment provider is not configured"},503);
    const currency=String(payment.currency).toUpperCase(),amount=Math.round(Number(payment.amount)*factor[currency]);
    if(!Number.isSafeInteger(amount)||amount<=0)return json({error:"Invalid reviewer payment amount"},400);
    const response=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${key}`},body:JSON.stringify({source:"balance",recipient:payment.recipient,amount,currency,reference:payment.reference})});
    const result=await response.json().catch(()=>({}));
    if(!response.ok){await service.from("reviewer_payments").update({status:"failed",failure_reason:result.message||"Provider rejected payment",updated_at:new Date().toISOString()}).eq("id",payment.id);return json({error:result.message||"Payment failed"},502);}
    const reference=result.data?.reference||result.reference||payment.reference;
    await service.from("reviewer_payments").update({status:"processing",provider:"paystack",provider_transaction_reference:reference,updated_at:new Date().toISOString()}).eq("id",payment.id);
    return json({ok:true,status:"processing",reference},202);
  }catch(error){return json({error:error instanceof Error?error.message:"Unexpected error"},500);}
});
