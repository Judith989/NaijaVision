import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-[#FAFAFA] text-[#1D1D1F] selection:bg-[#0066CC] selection:text-white flex flex-col">
      {/* Header */}
      <header className="w-full px-6 py-6 flex items-center justify-between border-b border-gray-200 bg-white">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-xs tracking-wider">NV</span>
          </div>
          <span className="font-semibold text-sm tracking-tight">Naija Vision</span>
        </div>
      </header>

      {/* Hero Section */}
      <section className="flex-1 flex flex-col items-center justify-center px-6 py-16 text-center max-w-4xl mx-auto">
        <div className="inline-block border border-gray-200 text-gray-500 text-xs font-semibold px-4 py-1.5 rounded-full uppercase tracking-wider mb-6">
          Open Source Dataset Initiative
        </div>
        
        <h1 className="text-5xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight leading-[1.1] mb-6">
          Preserving Nigerian <br /> Languages for the Future.
        </h1>
        
        <p className="text-lg sm:text-xl text-gray-500 max-w-2xl mb-12 leading-relaxed">
          Help train the next generation of AI and computer vision models. Record short prompts in your native language directly from your browser.
        </p>

        {/* Dos and Don'ts Grid */}
        <div className="grid sm:grid-cols-2 gap-6 w-full max-w-3xl mb-12 text-left">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <h3 className="text-emerald-600 font-bold flex items-center gap-2 mb-3">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              The Dos
            </h3>
            <ul className="text-sm text-gray-600 space-y-2 font-medium">
              <li>• Sit in a well-lit room facing a window or light source.</li>
              <li>• Keep your face clearly visible within the frame.</li>
              <li>• Speak naturally, clearly, and at a normal pace.</li>
              <li>• Ensure a quiet environment with minimal background noise.</li>
            </ul>
          </div>
          
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <h3 className="text-red-500 font-bold flex items-center gap-2 mb-3">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              The Don'ts
            </h3>
            <ul className="text-sm text-gray-600 space-y-2 font-medium">
              <li>• Do not sit with a bright window directly behind you.</li>
              <li>• Do not cover your mouth with your hands or props.</li>
              <li>• Do not whisper or shout the prompts.</li>
              <li>• Do not have music or television playing in the background.</li>
            </ul>
          </div>
        </div>

        <Link 
          href="/onboarding"
          className="bg-[#0066CC] hover:bg-[#0055B3] text-white px-8 py-4 rounded-full font-bold text-lg shadow-lg shadow-blue-500/20 hover:scale-105 transition-all duration-300"
        >
          Participate Now
        </Link>
      </section>
    </main>
  );
}