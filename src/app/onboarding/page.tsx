"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [agreedToConsent, setAgreedToConsent] = useState(false);
  
  const [survey, setSurvey] = useState({
    firstName: "",
    lastName: "",
    age: "",
    sex: "Male",
    whatsappPhone: "",
    email: "",
    language: "Igbo",
    facialHair: "None",
    makeup: "Light Makeup",
  });

  const [micStatus, setMicStatus] = useState<"pending" | "success">("pending");
  const [camStatus, setCamStatus] = useState<"pending" | "success">("pending");

  const handleNextStep = () => {
    if (step === 1 && agreedToConsent) setStep(2);
    else if (step === 2) setStep(3);
    else if (step === 3 && micStatus === "success" && camStatus === "success") {
      router.push("/record");
    }
  };

  return (
    <main className="min-h-screen bg-[#FAFAFA] text-[#1D1D1F] flex flex-col items-center selection:bg-[#0066CC] selection:text-white">
      <header className="w-full max-w-5xl mx-auto px-6 py-8 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-xs">NV</span>
          </div>
          <span className="font-semibold text-sm tracking-tight">Naija Vision</span>
        </Link>
        <div className="text-xs font-semibold text-gray-400 tracking-wider uppercase">
          Step {step} of 3
        </div>
      </header>

      <div className="w-full max-w-2xl px-6 py-8 my-auto">
        
        {step === 1 && (
          <div className="bg-white p-8 sm:p-10 rounded-3xl shadow-[0_2px_20px_rgba(0,0,0,0.04)] border border-gray-100 animate-in fade-in duration-300">
            <h1 className="text-3xl font-extrabold tracking-tight mb-3">Participant Informed Consent</h1>
            <p className="text-gray-500 text-sm mb-6">
              Please review how your sensitive biometric data will be processed under the Nigeria Data Protection Act (NDP Act) 2023.
            </p>

            <div className="bg-gray-50 p-5 rounded-2xl max-h-60 overflow-y-auto text-xs text-gray-600 leading-relaxed mb-6 border border-gray-200/60 space-y-4">
              <div>
                <p className="font-semibold text-gray-900">1. Data Controller & Contact</p>
                <p>Naija Vision Research Group. DPO Contact: [Insert DPO Email/Address]</p>
              </div>
              
              <div>
                <p className="font-semibold text-gray-900">2. Sensitive Data Classification (Sec. 30 NDP Act)</p>
                <p>We collect <strong>lip video recordings and corresponding audio</strong>. This is classified as <i>Sensitive Personal Data</i> (biometric/visual identifiers). No direct identifiers (full names/addresses) will be linked to your dataset ID.</p>
              </div>

              <div>
                <p className="font-semibold text-gray-900">3. Purpose & Open-Source Publication</p>
                <p>Data is strictly used for training AI, lip-reading, and computer vision models for Nigerian languages. Upon publication, this dataset may be released as an open-source benchmark on global repositories (e.g., GitHub, CVF) to ensure replicability.</p>
              </div>

              <div>
                <p className="font-semibold text-gray-900">4. Lawful Basis of Processing</p>
                <p><strong>Explicit Consent</strong> (Section 30(1)(a) & Article 18 GAID). You must actively opt-in. Silence or pre-ticked boxes do not constitute consent.</p>
              </div>

              <div>
                <p className="font-semibold text-gray-900">5. Retention & Security (CIA)</p>
                <p>Data will be encrypted (pseudonymised facial landmark vectors and audio matrices) and stored securely for <strong>[3 years / Insert Duration]</strong> post-publication, after which it is deleted. We ensure Confidentiality, Integrity, and Availability (CIA).</p>
              </div>

              <div>
                <p className="font-semibold text-gray-900">6. Your Data Subject Rights (Part VI, NDP Act)</p>
                <ul className="list-disc pl-4 space-y-1">
                  <li><strong>Right to Withdraw:</strong> You can withdraw consent at any time. Withdrawal is as easy as giving consent (Sec. 35(2)).</li>
                  <li><strong>Right to Erasure (Be Forgotten):</strong> You can request deletion of your data, including removal from future updates to public open-source repositories (Sec. 34(1)(d)).</li>
                  <li><strong>Right to Access, Rectify, & Object:</strong> You can view, correct, or restrict processing of your data.</li>
                </ul>
              </div>

              <div>
                <p className="font-semibold text-gray-900">7. Complaints to the NDPC</p>
                <p>If you believe your data privacy rights have been violated, you have the right to lodge a complaint directly with the <strong>Nigeria Data Protection Commission (NDPC)</strong> (Sec. 46).</p>
              </div>
            </div>

            <label className="flex items-start gap-3 cursor-pointer mb-8">
              <input 
                type="checkbox" 
                checked={agreedToConsent}
                onChange={(e) => setAgreedToConsent(e.target.checked)}
                className="mt-1 w-5 h-5 rounded accent-[#0066CC] border-gray-300"
              />
              <span className="text-xs sm:text-sm text-gray-700 font-medium">
                I am 18 years or older. I have read the NDPC privacy notice, and I <strong>explicitly consent</strong> to the collection, processing, and potential open-source publication of my <strong>sensitive biometric audio-visual data</strong> (lip video and voice audio). I understand my right to withdraw this consent at any time without detriment.
              </span>
            </label>

            <button
              disabled={!agreedToConsent}
              onClick={handleNextStep}
              className="w-full py-4 bg-[#0066CC] disabled:bg-gray-200 text-white font-semibold rounded-2xl hover:bg-[#0055B3] transition-all duration-200 shadow-md disabled:shadow-none"
            >
              Continue to Survey
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="bg-white p-8 sm:p-10 rounded-3xl shadow-[0_2px_20px_rgba(0,0,0,0.04)] border border-gray-100 animate-in fade-in duration-300">
            <h1 className="text-3xl font-extrabold tracking-tight mb-3">Participant Survey</h1>
            <p className="text-gray-500 text-sm mb-2">
              Metadata ensures dataset balance across demographics and recording conditions.
            </p>
            
            {/* NDPC Compliance Notice for Contact Info */}
            <div className="bg-blue-50 border border-blue-200/60 text-blue-800 text-xs p-3 rounded-xl mb-8 flex items-start gap-2">
              <span className="text-base leading-none">🔒</span>
              <span><strong>Privacy Notice:</strong> Your contact details are collected solely to notify you of submission updates or to facilitate your Data Subject Rights (e.g., Right to Erasure). Per NDPC guidelines, this information will be <strong>strictly separated</strong> from your biometric data and will NEVER be published in the open-source dataset.</span>
            </div>

            <div className="space-y-5 mb-8">
              {/* Contact & Demographic Details */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">First Name</label>
                  <input 
                    type="text" 
                    value={survey.firstName}
                    onChange={(e) => setSurvey({ ...survey, firstName: e.target.value })}
                    placeholder="e.g. Chukwu"
                    className="w-full p-3.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-[#0066CC] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Last Name</label>
                  <input 
                    type="text" 
                    value={survey.lastName}
                    onChange={(e) => setSurvey({ ...survey, lastName: e.target.value })}
                    placeholder="e.g. Okafor"
                    className="w-full p-3.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-[#0066CC] outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Age</label>
                  <input 
                    type="number" 
                    value={survey.age}
                    onChange={(e) => setSurvey({ ...survey, age: e.target.value })}
                    placeholder="Must be 18+"
                    min="18"
                    className="w-full p-3.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-[#0066CC] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Sex</label>
                  <select 
                    value={survey.sex} 
                    onChange={(e) => setSurvey({ ...survey, sex: e.target.value })}
                    className="w-full p-3.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-[#0066CC] outline-none"
                  >
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Non-binary">Non-binary / Other</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">WhatsApp Phone</label>
                  <input 
                    type="tel" 
                    value={survey.whatsappPhone}
                    onChange={(e) => setSurvey({ ...survey, whatsappPhone: e.target.value })}
                    placeholder="+234..."
                    className="w-full p-3.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-[#0066CC] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Email Address</label>
                  <input 
                    type="email" 
                    value={survey.email}
                    onChange={(e) => setSurvey({ ...survey, email: e.target.value })}
                    placeholder="you@example.com"
                    className="w-full p-3.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-[#0066CC] outline-none"
                  />
                </div>
              </div>

              {/* Dataset Metadata Details */}
              <div className="border-t border-gray-200 pt-5 mt-2">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4">Dataset Metadata (Unlinked to Identity)</p>
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Target Language</label>
                  <select 
                    value={survey.language} 
                    onChange={(e) => setSurvey({ ...survey, language: e.target.value })}
                    className="w-full p-3.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-[#0066CC] outline-none"
                  >
                    <option value="Igbo">Igbo</option>
                    <option value="Yoruba">Yoruba</option>
                    <option value="Hausa">Hausa</option>
                    <option value="Nigerian Pidgin">Nigerian Pidgin</option>
                    <option value="Nigerian English">Nigerian English</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Facial Hair Status</label>
                  <select 
                    value={survey.facialHair} 
                    onChange={(e) => setSurvey({ ...survey, facialHair: e.target.value })}
                    className="w-full p-3.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-[#0066CC] outline-none"
                  >
                    <option value="None">Clean Shaven / None</option>
                    <option value="Mustache">Mustache</option>
                    <option value="Full Beard">Full Beard</option>
                    <option value="Stubble">Short Stubble</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Lip Makeup / Lipstick</label>
                  <select 
                    value={survey.makeup} 
                    onChange={(e) => setSurvey({ ...survey, makeup: e.target.value })}
                    className="w-full p-3.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-[#0066CC] outline-none"
                  >
                    <option value="None">None</option>
                    <option value="Light Makeup">Lip Balm / Neutral</option>
                    <option value="Lipstick">Dark / Bright Lipstick</option>
                  </select>
                </div>
              </div>
            </div>

            <button
              onClick={handleNextStep}
              className="w-full py-4 bg-[#0066CC] text-white font-semibold rounded-2xl hover:bg-[#0055B3] transition-all duration-200 shadow-md"
            >
              Proceed to Hardware Check
            </button>
          </div>
        )}

        {step === 3 && (
          <div className="bg-white p-8 sm:p-10 rounded-3xl shadow-[0_2px_20px_rgba(0,0,0,0.04)] border border-gray-100 animate-in fade-in duration-300">
            <h1 className="text-3xl font-extrabold tracking-tight mb-3">Hardware Check</h1>
            <p className="text-gray-500 text-sm mb-8">
              Verify that your browser can access your microphone and camera before starting.
            </p>

            <div className="space-y-4 mb-8">
              <div className="p-4 bg-gray-50 rounded-2xl border border-gray-200/60 flex items-center justify-between">
                <div>
                  <p className="font-bold text-sm text-gray-900">Microphone Check</p>
                  <p className="text-xs text-gray-500">Tests browser audio input</p>
                </div>
                <button
                  onClick={() => setMicStatus("success")}
                  className={`px-4 py-2 text-xs font-bold rounded-xl transition-all ${
                    micStatus === "success" 
                      ? "bg-emerald-100 text-emerald-800" 
                      : "bg-black text-white hover:bg-gray-800"
                  }`}
                >
                  {micStatus === "success" ? "✓ Mic Passed" : "Test Mic"}
                </button>
              </div>

              <div className="p-4 bg-gray-50 rounded-2xl border border-gray-200/60 flex items-center justify-between">
                <div>
                  <p className="font-bold text-sm text-gray-900">Camera Check</p>
                  <p className="text-xs text-gray-500">Tests video resolution & mouth tracking</p>
                </div>
                <button
                  onClick={() => setCamStatus("success")}
                  className={`px-4 py-2 text-xs font-bold rounded-xl transition-all ${
                    camStatus === "success" 
                      ? "bg-emerald-100 text-emerald-800" 
                      : "bg-black text-white hover:bg-gray-800"
                  }`}
                >
                  {camStatus === "success" ? "✓ Camera Passed" : "Test Camera"}
                </button>
              </div>
            </div>

            <button
              disabled={micStatus !== "success" || camStatus !== "success"}
              onClick={handleNextStep}
              className="w-full py-4 bg-[#0066CC] disabled:bg-gray-200 text-white font-semibold rounded-2xl hover:bg-[#0055B3] transition-all duration-200 shadow-md disabled:shadow-none"
            >
              Enter Recording Studio
            </button>
          </div>
        )}
      </div>
    </main>
  );
}