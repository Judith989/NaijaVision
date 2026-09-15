import { json, serviceClient } from "../_shared/security.ts";
const hex=(value:ArrayBuffer)=>Array.from(new Uint8Array(value)).map((b)=>b.toString(16).padStart(2,"0")).join("");
function equal(a:string,b:string){if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i+=1)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;}
Deno.serve(async(request)=>{
  if(request.method!=="POST")return json({error:"Method not allowed"},405);
  const secret=Deno.env.get("PAYMENTS_WEBHOOK_SECRET")||Deno.env.get("PAYMENTS_PROVIDER_API_KEY");
  if(!secret)return json({error:"Webhook verification is not configured"},503);
  const raw=await request.text();
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-512"},false,["sign"]);
  const expected=hex(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(raw)));
  const supplied=request.headers.get("x-paystack-signature")?.toLowerCase()||"";
  if(!supplied||!equal(supplied,expected))return json({error:"Invalid webhook signature"},401);
  const event=JSON.parse(raw);
  if(!["transfer.success","transfer.failed","transfer.reversed"].includes(event?.event))return json({ok:true,ignored:true});
  const reference=event?.data?.reference;
  if(!reference)return json({error:"Transfer reference is missing"},400);
  const service=serviceClient();
  const {data:payment}=await service.from("payments").select("id,submission_id,user_id,amount,currency,status").eq("provider_transaction_reference",reference).maybeSingle();
  if(!payment){
    const {data:reviewerPayment}=await service.from("reviewer_payments").select("id,reviewer_id,amount,currency,status").eq("provider_transaction_reference",reference).maybeSingle();
    if(!reviewerPayment)return json({ok:true,ignored:true});
    const now=new Date().toISOString();
    const successful=event.event==="transfer.success";
    await service.from("reviewer_payments").update(successful
      ? {status:"paid",paid_at:now,processed_at:now,failure_reason:null,updated_at:now}
      : {status:"failed",failure_reason:String(event?.data?.reason||event?.data?.message||event.event),updated_at:now}
    ).eq("id",reviewerPayment.id);
    if(successful)await service.from("notifications").insert({user_id:reviewerPayment.reviewer_id,type:"reviewer_payment_paid",title:"Reviewer payment sent",message:`Your ${reviewerPayment.amount} ${reviewerPayment.currency} reviewer payment has been processed.`});
    await service.from("audit_events").insert({actor_id:null,action:event.event,entity_type:"reviewer_payment",entity_id:reviewerPayment.id,after_data:event.data});
    return json({ok:true});
  }
  const now=new Date().toISOString();
  if(event.event==="transfer.success"){
    if(payment.status!=="paid"){
      await service.from("payments").update({status:"paid",processed_at:now,failure_reason:null,updated_at:now}).eq("id",payment.id);
      await service.from("submissions").update({status:"paid",paid_at:now,updated_at:now}).eq("id",payment.submission_id);
      await service.from("notifications").insert({user_id:payment.user_id,type:"payment_paid",title:"Compensation sent",message:`Your ${payment.amount} ${payment.currency} compensation has been processed.`});
    }
  }else{
    const reason=event?.data?.reason||event?.data?.message||event.event.replace("transfer.","Transfer ");
    await service.from("payments").update({status:"failed",failure_reason:String(reason),updated_at:now}).eq("id",payment.id);
    await service.from("submissions").update({status:"payment_eligible",updated_at:now}).eq("id",payment.submission_id);
  }
  await service.from("audit_events").insert({actor_id:null,action:event.event,entity_type:"payment",entity_id:payment.id,after_data:event.data});
  return json({ok:true});
});
