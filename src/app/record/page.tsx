"use client";

import { useState, useRef } from "react";
import Link from "next/link";

export default function RecordPage() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  
  // Drag-and-Drop State for Bounding Box
  const [boxPos, setBoxPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOrigin = useRef({ x: 0, y: 0 });

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    setIsDragging(true);
    // Calculate the offset between the mouse click and the current box position
    dragOrigin.current = { 
      x: e.clientX - boxPos.x, 
      y: e.clientY - boxPos.y 
    };
    // Capture pointer so dragging works even if the mouse moves fast
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    
    // Calculate new position
    let newX = e.clientX - dragOrigin.current.x;
    let newY = e.clientY - dragOrigin.current.y;

    // Soft bounds to prevent users from dragging the box entirely out of the camera view
    newX = Math.max(-250, Math.min(250, newX));
    newY = Math.max(-150, Math.min(150, newY));

    setBoxPos({ x: newX, y: newY });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    setIsDragging(false);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  };

  return (
    <main className="h-screen w-full flex bg-[#FAFAFA] text-[#1D1D1F] overflow-hidden selection:bg-[#0066CC] selection:text-white">
      
      {/* LEFT: Main Recording Workspace */}
      <div className="flex-1 flex flex-col h-full relative transition-all duration-300">
        
        <header className="w-full px-6 py-4 flex items-center justify-between bg-white/80 backdrop-blur-md border-b border-gray-200 z-40">
          <div className="flex items-center gap-3">
            <Link href="/" className="w-8 h-8 bg-black rounded-lg flex items-center justify-center hover:opacity-80 transition-opacity">
              <span className="text-white font-bold text-xs tracking-wider">NV</span>
            </Link>
            <span className="font-semibold text-sm tracking-tight hidden sm:inline-block">Naija Vision</span>
          </div>

          <div className="bg-gray-100/80 border border-gray-200/60 px-4 py-1.5 rounded-full flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse"></span>
            <span className="text-xs font-medium text-gray-600 tracking-tight">
              Prompt <strong className="text-black font-semibold">45</strong> / 60
            </span>
          </div>

          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className={`px-4 py-2 rounded-full text-xs font-bold transition-all duration-200 flex items-center gap-2 ${
              isSidebarOpen 
                ? "bg-gray-100 text-gray-700 hover:bg-gray-200" 
                : "bg-[#0066CC] text-white hover:bg-[#0055B3] shadow-md"
            }`}
          >
            {isSidebarOpen ? (
              <>
                Enter Focus Mode
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>
                View Dashboard
              </>
            )}
          </button>
        </header>

        <div className="flex-1 overflow-y-auto flex flex-col lg:flex-row items-stretch">
          
          <div className="flex-1 px-8 py-12 lg:py-20 flex flex-col justify-center">
            <div className="max-w-xl mx-auto lg:mx-0">
              <div className="inline-block border border-gray-200 text-gray-500 text-xs font-semibold px-3 py-1 rounded-full uppercase tracking-wider mb-8">
                Yoruba
              </div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-balance leading-tight mb-6">
                Ẹ káàbọ̀. <br />
                Ṣé o dà bí ohun tí mo sọ?
              </h1>
              <p className="text-xl sm:text-2xl text-gray-400 font-medium tracking-tight">
                Hello. Can you hear what I said?
              </p>
            </div>
          </div>

          <div className="flex-1 p-6 lg:p-12 flex flex-col justify-center items-center bg-white border-l border-gray-100">
            <div className="w-full max-w-xl">
              
              <div className="relative w-full aspect-[4/3] sm:aspect-video bg-[#1D1D1F] rounded-3xl overflow-hidden shadow-2xl mb-8 border border-gray-100">
                <div className="absolute top-4 right-4 bg-black/50 backdrop-blur-md text-white text-xs font-medium px-3 py-1.5 rounded-full flex items-center gap-2 border border-white/10 z-10 pointer-events-none">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                  Optimal Condition
                </div>
                
                {/* Draggable Bounding Box Overlay */}
                <div className="absolute inset-0 flex items-center justify-center overflow-hidden z-10">
                  <div 
                    className={`w-2/3 h-1/2 border-2 rounded-2xl relative flex items-center justify-center transition-colors duration-200 select-none group ${
                      isDragging ? 'border-green-400 bg-green-500/10 cursor-grabbing' : 'border-green-500/40 hover:border-green-400/80 hover:bg-green-500/5 cursor-grab'
                    }`}
                    style={{ 
                      transform: `translate(${boxPos.x}px, ${boxPos.y}px)`,
                      touchAction: 'none' // Prevents mobile scrolling while dragging
                    }}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                  >
                    {/* Visual Cue Text */}
                    <span className={`text-white/60 text-xs font-medium tracking-wide transition-opacity duration-300 pointer-events-none ${isDragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                      Drag to align with lips
                    </span>

                    {/* Corner Accents */}
                    <div className="absolute -top-1 -left-1 w-4 h-4 border-t-4 border-l-4 border-green-500 rounded-tl-lg pointer-events-none"></div>
                    <div className="absolute -top-1 -right-1 w-4 h-4 border-t-4 border-r-4 border-green-500 rounded-tr-lg pointer-events-none"></div>
                    <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-4 border-l-4 border-green-500 rounded-bl-lg pointer-events-none"></div>
                    <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-4 border-r-4 border-green-500 rounded-br-lg pointer-events-none"></div>
                  </div>
                </div>

                <div className="absolute inset-0 flex items-center justify-center text-gray-500 font-medium pointer-events-none">
                  [ Webcam Stream ]
                </div>
              </div>

              {/* Fixed Audio Visualizer */}
              <div className="w-full h-8 flex items-end justify-center gap-1 mb-8 opacity-60">
                {[...Array(30)].map((_, i) => {
                  const pseudoRandomHeight = 20 + Math.abs(Math.sin(i * 1.3) * 80);
                  return (
                    <div 
                      key={i} 
                      className={`w-1.5 rounded-t-sm ${i > 22 ? 'bg-gray-300' : 'bg-green-500'}`}
                      style={{ height: `${pseudoRandomHeight}%` }}
                    ></div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between w-full">
                <span className="text-gray-500 font-medium font-mono text-sm">00:00 / 00:08</span>
                <div className="flex items-center gap-4">
                  <button className="text-gray-500 hover:text-black font-medium text-sm transition-colors px-4 py-2">
                    Discard
                  </button>
                  <button className="bg-red-500 hover:bg-red-600 text-white flex items-center gap-2 px-6 py-3 rounded-full shadow-lg shadow-red-500/20 hover:scale-105 transition-all duration-300 font-semibold tracking-tight">
                    <div className="w-3 h-3 bg-white rounded-full"></div>
                    Start Recording
                  </button>
                </div>
                <button className="text-gray-500 hover:text-black font-medium text-sm transition-colors px-4 py-2 flex items-center gap-1">
                  Play
                </button>
              </div>

            </div>
          </div>
        </div>
      </div>

      {/* RIGHT: Persistent Dashboard Sidebar */}
      <aside 
        className={`h-full bg-white border-l border-gray-200 flex flex-col transition-all duration-300 ease-in-out shadow-[-10px_0_30px_rgba(0,0,0,0.02)] z-50 ${
          isSidebarOpen ? "w-80 lg:w-96 translate-x-0" : "w-0 translate-x-full border-none opacity-0"
        }`}
      >
        <div className="p-6 border-b border-gray-100 min-w-[320px]">
          <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-1">Participant Profile</p>
          <div className="flex items-start justify-between">
            <h2 className="text-lg font-bold text-gray-900 leading-tight">Adaeze N.<br/><span className="text-sm font-medium text-gray-500">ID: YOR_00123</span></h2>
            <span className="bg-emerald-50 text-emerald-700 border border-emerald-200/60 text-[10px] font-bold px-2 py-0.5 rounded-full">
              Verified
            </span>
          </div>
        </div>

        <div className="p-6 border-b border-gray-100 flex-1 min-w-[320px]">
          <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-4">Session Stats</p>
          <div className="grid grid-cols-2 gap-3 mb-8">
            <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
              <span className="text-xs text-gray-500 font-medium block mb-1">Approved</span>
              <span className="text-2xl font-bold text-gray-900">86 <span className="text-sm text-gray-400">/150</span></span>
            </div>
            <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
              <span className="text-xs text-gray-500 font-medium block mb-1">Total Earned</span>
              <span className="text-2xl font-bold text-emerald-600">₦4,500</span>
            </div>
          </div>

          <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-4">Quick Actions</p>
          <div className="space-y-2">
            <Link href="/onboarding" className="flex items-center justify-between p-3 rounded-xl hover:bg-gray-50 border border-transparent hover:border-gray-100 transition-colors text-sm font-medium text-gray-700">
              <span>Re-test Equipment</span>
              <span className="text-xs text-gray-400">Mic/Cam</span>
            </Link>
            <button className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-gray-50 border border-transparent hover:border-gray-100 transition-colors text-sm font-medium text-gray-700">
              <span>Report Issue with Prompt</span>
            </button>
            <button className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-gray-50 border border-transparent hover:border-gray-100 transition-colors text-sm font-medium text-gray-700">
              <span>Privacy & NDPC Notice</span>
            </button>
          </div>
        </div>

        <div className="p-6 bg-gray-50/50 mt-auto min-w-[320px]">
          <Link href="/" className="flex items-center justify-center w-full py-3.5 bg-black hover:bg-gray-800 text-white font-semibold rounded-xl text-sm transition-all shadow-md">
            Save Session & Exit
          </Link>
        </div>
      </aside>
      
    </main>
  );
}