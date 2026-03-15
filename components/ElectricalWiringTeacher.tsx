import React, { useRef, useEffect } from 'react';
import { LessonStage, ElectricalWiringTeacherProps } from '../types';

const ElectricalWiringTeacher: React.FC<ElectricalWiringTeacherProps> = ({
  lessonStage,
  isConnected,
  videoUrl,
  partAnalysis,
  inventoryItems,
  aisleSignPath,
  countdownValue
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Force autoplay when video URL changes - critical for kiosk without user interaction
  useEffect(() => {
    if (lessonStage === LessonStage.PLAYING_VIDEO && videoUrl && videoRef.current) {
      const video = videoRef.current;

      // Start muted to satisfy browser autoplay policy, then unmute
      video.muted = true;
      video.play()
        .then(() => {
          // Successfully started - unmute for audio
          video.muted = false;
        })
        .catch((err) => {
          console.error('Video autoplay failed:', err);
          // Keep trying muted if unmute fails
          video.muted = true;
          video.play().catch(e => console.error('Muted autoplay also failed:', e));
        });
    }
  }, [lessonStage, videoUrl]);
  const isCompare = lessonStage === LessonStage.COMPARE_THREADS;
  const isHighlight = lessonStage === LessonStage.HIGHLIGHT_FERRULE;
  const isIdle = lessonStage === LessonStage.IDLE;
  const isPlaying = lessonStage === LessonStage.PLAYING_VIDEO;
  const isAnalyzing = lessonStage === LessonStage.ANALYZING_PART;
  const isShowingAnalysis = lessonStage === LessonStage.SHOWING_ANALYSIS;
  const isShowingInventory = lessonStage === LessonStage.SHOWING_INVENTORY;
  const isShowingAisle = lessonStage === LessonStage.SHOWING_AISLE;

  return (
    <div className="w-full h-full flex items-center justify-center relative overflow-hidden workshop-paper border-8 border-[#2F4F4F] shadow-2xl rounded-lg">


      {isIdle && !isConnected && (
        <div className="text-center p-8 border-4 border-dashed border-[#003366]/30 rounded-xl">
          <h2 className="text-3xl text-[#003366] font-bold mb-4 animate-pulse">WAITING FOR NEW CUSTOMER</h2>
        </div>
      )}

      {isIdle && isConnected && (
        <div className="text-center p-8 border-4 border-dashed border-[#003366]/30 rounded-xl">
          <h2 className="text-3xl text-[#003366] font-bold mb-4">Welcome, How can we help you?</h2>
        </div>
      )}

      {isPlaying && videoUrl && (
        <div className="w-full h-full bg-black relative flex items-center justify-center">
          {videoUrl.includes('drive.google.com') ? (
            <iframe
              src={videoUrl}
              className="w-full h-full border-none"
              allow="autoplay; encrypted-media"
              allowFullScreen
              title="Instructional Video"
            />
          ) : (
            <video
              ref={videoRef}
              key={videoUrl}
              src={videoUrl}
              autoPlay
              muted
              playsInline
              className="max-w-full max-h-full border-4 border-[#1a1a1a] shadow-[0_0_50px_rgba(0,0,0,0.5)]"
            />
          )}

          <div className="absolute top-0 left-0 bg-[#003366] text-white text-xs px-2 py-1 font-mono z-20 pointer-events-none">
            SOURCE: {videoUrl.includes('drive.google.com') ? 'CLOUD_ARCHIVE' : 'LOCAL_STORAGE'}
          </div>
        </div>
      )}

      {(isCompare || isHighlight) && (
        <svg viewBox="0 0 800 500" className="w-full h-full p-8 transition-all duration-700">
          <defs>
            <pattern id="diagonalHatch" width="10" height="10" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
              <line x1="0" y1="0" x2="0" y2="10" className="blueprint-ink" strokeWidth="1" />
            </pattern>
            <linearGradient id="copper" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#cd7f32" />
              <stop offset="50%" stopColor="#b87333" />
              <stop offset="100%" stopColor="#8b4513" />
            </linearGradient>
            <linearGradient id="insulation" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#444" />
              <stop offset="50%" stopColor="#222" />
              <stop offset="100%" stopColor="#111" />
            </linearGradient>
          </defs>

          {/* LEFT DIAGRAM: SOLID WIRE */}
          <g
            className={`transition-all duration-700 transform ${isHighlight ? 'opacity-20 -translate-x-20' : 'opacity-100'}`}
          >
            <text x="200" y="50" textAnchor="middle" className="blueprint-ink text-xl font-bold tracking-widest">SOLID WIRE</text>
            <text x="200" y="450" textAnchor="middle" className="fill-red-800 text-lg font-bold">LIMITED BENDING</text>

            {/* Insulation */}
            <rect x="50" y="220" width="150" height="60" fill="url(#insulation)" rx="5" />
            {/* Stripped Copper Core */}
            <rect x="200" y="235" width="120" height="30" fill="url(#copper)" rx="2" />
            <line x1="200" y1="210" x2="200" y2="290" stroke="#003366" strokeWidth="2" strokeDasharray="4,4" />
          </g>

          {/* RIGHT DIAGRAM: STRANDED WIRE */}
          <g
            className={`transition-all duration-700 transform ${isHighlight ? 'translate-x-[-200px] scale-125' : ''}`}
            style={{ transformOrigin: '600px 250px' }}
          >
            <text x="600" y="50" textAnchor="middle" className="blueprint-ink text-xl font-bold tracking-widest">STRANDED WIRE</text>
            <text x="600" y="450" textAnchor="middle" className="blueprint-ink text-lg font-bold">
              {isHighlight ? '' : 'FLEXIBLE'}
            </text>

            {/* Insulation */}
            <rect x="450" y="220" width="150" height="60" fill="url(#insulation)" rx="5" />

            {/* Strands */}
            {Array.from({ length: 6 }).map((_, i) => (
              <path key={i} d={`M600,${225 + (i * 10)} Q660,${220 + (i * 12)} 720,${225 + (i * 10)}`} fill="none" stroke="url(#copper)" strokeWidth="4" />
            ))}

            <line x1="600" y1="210" x2="600" y2="290" stroke="#003366" strokeWidth="2" strokeDasharray="4,4" />

            {isHighlight && (
              <g className="animate-fade-in">
                <line x1="600" y1="180" x2="720" y2="180" stroke="#FF4500" strokeWidth="3" />
                <line x1="600" y1="170" x2="600" y2="190" stroke="#FF4500" strokeWidth="3" />
                <line x1="720" y1="170" x2="720" y2="190" stroke="#FF4500" strokeWidth="3" />
                <text
                  x="660"
                  y="160"
                  textAnchor="middle"
                  className="fill-[#FF4500] text-xl font-black"
                  data-testid="strip-length-label"
                >
                  3/4" STRIP LENGTH
                </text>
              </g>
            )}
          </g>
        </svg>
      )}

      {/* COUNTDOWN TO SNAPSHOT */}
      {lessonStage === LessonStage.COUNTDOWN_TO_SNAPSHOT && (
        <div className="text-center p-8 flex flex-col items-center justify-center h-full">
          <h2 className="text-4xl text-[#003366] font-bold mb-8 animate-pulse">
            HOLD UP YOUR PART
          </h2>
          <div className="text-[12rem] font-black text-[#003366] leading-none mb-4">
            {countdownValue}
          </div>
          <p className="text-2xl text-[#003366] font-bold">
            Capturing in {countdownValue}...
          </p>
        </div>
      )}

      {/* ANALYZING PART - Loading Spinner */}
      {isAnalyzing && (
        <div className="text-center p-8">
          <div className="inline-block animate-spin rounded-full h-24 w-24 border-8 border-[#003366] border-t-transparent mb-6"></div>
          <h2 className="text-3xl text-[#003366] font-bold mb-2">AI ANALYSIS</h2>
          <p className="text-[#003366] text-xl">Sparky is examining your part...</p>
        </div>
      )}

      {/* SHOWING ANALYSIS - Snapshot + Part Name (Sparky explains verbally) */}
      {isShowingAnalysis && partAnalysis && (
        <div className="w-full h-full flex flex-col items-center justify-center p-6 bg-[#F5F5DC]">
          <h2 className="text-3xl text-[#003366] font-bold mb-6 border-b-4 border-[#003366] pb-2">
            PART IDENTIFIED: {partAnalysis.partName}
          </h2>

          <div className="border-4 border-[#003366] rounded-lg overflow-hidden shadow-lg max-w-2xl">
            <img
              src={`data:image/jpeg;base64,${partAnalysis.snapshotBase64}`}
              alt="Part snapshot"
              className="w-full h-auto"
            />
          </div>
        </div>
      )}

      {/* SHOWING INVENTORY - Product List */}
      {isShowingInventory && inventoryItems && (
        <div className="w-full h-full overflow-y-auto p-6 bg-[#F5F5DC]">
          <h2 className="text-3xl text-[#003366] font-bold mb-4 border-b-4 border-[#003366] pb-2">
            🏪 INVENTORY RESULTS
          </h2>

          {inventoryItems.length === 0 ? (
            <p className="text-xl text-[#003366] text-center mt-12">No items found. Please ask Sparky for help!</p>
          ) : (
            <div className="space-y-4">
              {inventoryItems.map((item) => (
                <div
                  key={item.id}
                  className="bg-white border-4 border-[#003366] rounded-lg p-4 shadow-lg"
                >
                  <h3 className="text-2xl text-[#003366] font-bold mb-2">{item.name}</h3>
                  <p className="text-[#003366] mb-3">{item.description}</p>

                  <div className="flex justify-between items-center border-t-2 border-[#003366]/30 pt-3">
                    <div>
                      <span className="text-3xl text-green-700 font-bold">${item.price.toFixed(2)}</span>
                    </div>
                    <div className="text-right">
                      <div className="text-lg text-[#003366] font-bold">{item.aisle}</div>
                      <div className={`text-sm font-bold ${item.stock > 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {item.stock > 0 ? `${item.stock} in stock` : 'Out of stock'}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SHOWING AISLE - Aisle Sign */}
      {isShowingAisle && aisleSignPath && (
        <div className="w-full h-full flex flex-col items-center justify-center p-6 bg-[#F5F5DC]">
          <h2 className="text-4xl text-[#003366] font-bold mb-6">📍 FIND IT HERE</h2>

          <div className="border-8 border-[#003366] rounded-lg overflow-hidden shadow-2xl max-w-3xl">
            <img
              src={aisleSignPath}
              alt="Aisle sign"
              className="w-full h-auto"
              onError={(e) => {
                // Fallback if image not found
                (e.target as HTMLImageElement).src = 'data:image/svg+xml;base64,' + btoa(`
                  <svg width="400" height="300" xmlns="http://www.w3.org/2000/svg">
                    <rect width="400" height="300" fill="#003366"/>
                    <text x="50%" y="50%" fill="white" font-size="48" font-weight="bold" text-anchor="middle" dominant-baseline="middle">
                      ${aisleSignPath.replace(/[^0-9]/g, '')}
                    </text>
                  </svg>
                `);
              }}
            />
          </div>

          <p className="text-2xl text-[#003366] mt-6 font-bold">Look for this sign in the store!</p>
        </div>
      )}
    </div>
  );
};

export default ElectricalWiringTeacher;