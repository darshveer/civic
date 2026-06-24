/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { Camera, Upload, MapPin, Sparkles, Check } from 'lucide-react';
import { db, incrementReportsCount, rewardImpactPoints } from '../lib/firebase';
import { collection, addDoc } from 'firebase/firestore';
import { TriageResult, CivicIssue } from '../types';

interface ReporterProps {
  onSuccess: (newIssue: any) => void;
  currentUser: any;
}

export default function Reporter({ onSuccess, currentUser }: ReporterProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState<boolean>(false);
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locatingState, setLocatingState] = useState<'idle' | 'tracking' | 'success' | 'failed'>('idle');
  const [geolocError, setGeolocError] = useState<string | null>(null);

  const [isTriaging, setIsTriaging] = useState<boolean>(false);
  const [triageError, setTriageError] = useState<string | null>(null);
  const [triageOutput, setTriageOutput] = useState<{
    triage: TriageResult;
    status: string;
    isCorroborated: boolean;
    corroboratedGroupId: string | null;
  } | null>(null);

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isDone, setIsDone] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { requestLocation(); }, []);

  const requestLocation = () => {
    if (!navigator.geolocation) {
      setLocatingState('failed'); setGeolocError('Geolocation not supported.');
      return;
    }
    setLocatingState('tracking'); setGeolocError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude });
        setLocatingState('success');
      },
      (error) => {
        setLocatingState('failed');
        setLocation({ latitude: 12.9716, longitude: 77.5946 });
        setGeolocError('Location access denied. Defaulting to Bangalore city center.');
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const startCamera = async () => {
    setIsCapturing(true); setTriageOutput(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (err) {
      setIsCapturing(false); setTriageError('Camera error. Please upload a file.');
    }
  };

  const capturePhoto = () => {
    if (videoRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth || 640;
      canvas.height = videoRef.current.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg');
        setImagePreview(dataUrl);
        fetch(dataUrl).then(res => res.blob()).then(blob => setSelectedFile(new File([blob], "capture.jpg", { type: "image/jpeg" })));
      }
      stopCamera();
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsCapturing(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file); setTriageOutput(null);
      const reader = new FileReader();
      reader.onload = () => setImagePreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const triggerAITriage = async () => {
    if (!imagePreview || !location) return;
    setIsTriaging(true); setTriageError(null); setTriageOutput(null);
    try {
      const response = await fetch('/api/triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imagePreview, mimeType: selectedFile?.type || 'image/jpeg', ...location })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setTriageOutput(data);
    } catch (err: any) {
      setTriageError(err.message || 'Error occurred.');
    } finally { setIsTriaging(false); }
  };

  const submitIssueToFirestore = async () => {
    if (!currentUser) return setTriageError('Please sign in first.');
    if (!location || !triageOutput) return;
    setIsSubmitting(true);
    try {
      const issueData: Omit<CivicIssue, 'id'> = {
        imageUrl: imagePreview || '',
        category: triageOutput?.triage?.category || 'Other',
        severityScore: triageOutput?.triage?.severityScore ?? 5,
        confidencePercentage: triageOutput?.triage?.confidencePercentage ?? 50,
        recommendedDepartment: triageOutput?.triage?.recommendedDepartment || 'General Operations',
        description: triageOutput?.triage?.autoGeneratedDescription || 'Reported civic issue.',
        ...location,
        reportedByUid: currentUser.uid,
        reportedByName: currentUser.displayName || 'Civic Hero',
        reportedAt: Date.now(),
        status: triageOutput.status as any,
        upvotesCount: 0,
        isCorroborated: triageOutput.isCorroborated || false,
        corroboratedGroupId: triageOutput.corroboratedGroupId || null
      };
      const docRef = await addDoc(collection(db, 'issues'), issueData);
      await rewardImpactPoints(currentUser.uid, 10);
      await incrementReportsCount(currentUser.uid);
      setIsDone(true);
      onSuccess({ id: docRef.id, ...issueData });
      setTimeout(resetForm, 4000);
    } catch (err: any) { setTriageError(err.message); } finally { setIsSubmitting(false); }
  };

  const resetForm = () => { setSelectedFile(null); setImagePreview(null); setTriageOutput(null); setTriageError(null); setIsDone(false); stopCamera(); };

  return (
    <div className="bg-white rounded-3xl border border-[#E5E5E5] overflow-hidden shadow-[-10px_0_15px_rgba(0,0,0,0.02)] max-w-2xl mx-auto">
      <div className="p-6 border-b border-[#E5E5E5] flex justify-between items-center bg-white">
        <div>
          <h2 className="text-xl font-light tracking-tight text-[#1A1A1A]">Civic Reporter</h2>
          <p className="text-xs text-[#717171] mt-1">Capture visual evidence and submit.</p>
        </div>
        <div onClick={requestLocation} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest cursor-pointer border border-[#E5E5E5] bg-[#F9FAFB] text-[#4A4A4A]">
          <MapPin className="w-3 h-3" />
          <span>{locatingState === 'success' && location ? `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}` : 'Locating...'}</span>
        </div>
      </div>

      <div className="p-6 md:p-8 space-y-6">
        {geolocError && <div className="text-xs text-[#B91C1C] p-3 rounded-lg bg-[#FEE2E2]">{geolocError}</div>}

        {!imagePreview && !isCapturing && (
          <div className="grid grid-cols-2 gap-4">
            <button onClick={startCamera} className="border border-[#E5E5E5] hover:border-[#1A1A1A] rounded-2xl p-8 flex flex-col items-center justify-center transition-colors text-[#1A1A1A] bg-[#F9FAFB]">
              <Camera className="w-6 h-6 mb-3 text-[#717171]" />
              <span className="font-semibold text-sm">Open Camera</span>
            </button>
            <button onClick={() => fileInputRef.current?.click()} className="border border-[#E5E5E5] hover:border-[#1A1A1A] rounded-2xl p-8 flex flex-col items-center justify-center transition-colors text-[#1A1A1A] bg-[#F9FAFB]">
              <Upload className="w-6 h-6 mb-3 text-[#717171]" />
              <span className="font-semibold text-sm">Upload Image</span>
              <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" className="hidden" />
            </button>
          </div>
        )}

        {isCapturing && (
          <div className="relative rounded-2xl overflow-hidden bg-[#1A1A1A]">
            <video ref={videoRef} autoPlay playsInline className="w-full h-80 object-cover opacity-90" />
            <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-4">
              <button onClick={capturePhoto} className="px-6 py-3 bg-white text-[#1A1A1A] rounded-full text-xs font-bold uppercase tracking-widest shadow-[0_2px_4px_rgba(0,0,0,0.1)]">Snap Photo</button>
              <button onClick={stopCamera} className="px-6 py-3 bg-[#1A1A1A]/50 border border-white/20 text-white rounded-full text-xs font-bold uppercase tracking-widest backdrop-blur-md">Cancel</button>
            </div>
          </div>
        )}

        {imagePreview && !triageOutput && !isTriaging && (
          <div className="space-y-4">
            <div className="relative rounded-2xl overflow-hidden border border-[#E5E5E5] bg-[#F9FAFB] flex justify-center py-4 px-2">
              <img src={imagePreview} className="max-h-72 object-contain rounded-xl" alt="Preview"/>
              <button onClick={resetForm} className="absolute top-4 right-4 px-4 py-1.5 bg-white border border-[#E5E5E5] text-[10px] font-bold uppercase tracking-widest rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.05)] text-[#1A1A1A]">Retake</button>
            </div>
            <button onClick={triggerAITriage} disabled={!location} className="w-full py-4 px-6 bg-[#1A1A1A] hover:bg-[#333333] text-white rounded-full font-bold text-xs uppercase tracking-widest transition-colors flex items-center justify-center gap-2 disabled:bg-[#E5E5E5] disabled:text-[#9CA3AF]">
              <Sparkles className="w-4 h-4" /> Analyze with AI
            </button>
          </div>
        )}

        {isTriaging && (
          <div className="p-12 text-center bg-[#F9FAFB] rounded-2xl border border-[#E5E5E5] flex flex-col items-center">
            <div className="w-6 h-6 rounded-full border-2 border-[#1A1A1A] border-t-transparent animate-spin mb-4"></div>
            <p className="text-sm font-semibold text-[#1A1A1A]">Agentic Triage Active</p>
            <p className="text-xs text-[#717171] mt-1">Classifying issue and routing to appropriate department.</p>
          </div>
        )}

        {triageError && (
          <div className="p-4 bg-[#FEE2E2] rounded-xl text-xs text-[#B91C1C]">
            <strong>Error:</strong> {triageError} <button onClick={resetForm} className="underline ml-2 font-bold focus:outline-none">Try again</button>
          </div>
        )}

        {triageOutput && triageOutput.triage && !isTriaging && !isDone && (
          <div className="bg-[#F9FAFB] rounded-2xl border border-[#E5E7EB] p-6 space-y-5">
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-[10px] font-bold text-[#717171] uppercase tracking-widest flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#EF4444] animate-pulse"></span>
                Triage Stream
              </h3>
              <span className="text-[10px] bg-white font-bold px-2 py-1 border border-[#E5E5E5] rounded text-[#10B981]">
                {triageOutput.triage.confidencePercentage}% Match
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4 pb-4 border-b border-[#E5E7EB]">
              <div>
                <div className="text-[10px] text-[#9CA3AF] uppercase font-bold mb-1 tracking-widest">Category</div>
                <div className="text-sm font-semibold text-[#1A1A1A]">{triageOutput.triage.category}</div>
              </div>
              <div>
                <div className="text-[10px] text-[#9CA3AF] uppercase font-bold mb-1 tracking-widest">Severity</div>
                <div className="text-sm font-semibold text-[#1A1A1A]">{triageOutput.triage.severityScore}/10</div>
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-[#E5E5E5]">
              <div className="text-[10px] text-[#9CA3AF] uppercase font-bold mb-1 tracking-widest">Routing</div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-[#1A1A1A] truncate pr-2">{triageOutput.triage.recommendedDepartment}</span>
                <span className="text-[10px] px-2 py-1 rounded font-bold uppercase text-[#3B82F6] bg-[#EFF6FF] shrink-0">{triageOutput.status}</span>
              </div>
            </div>

            <p className="text-xs text-[#4B5563] italic font-serif leading-relaxed px-1">"{triageOutput.triage.autoGeneratedDescription}"</p>

            <div className="pt-4 flex gap-3">
              <button onClick={submitIssueToFirestore} disabled={isSubmitting} className="flex-1 bg-[#1A1A1A] text-white py-3.5 rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-[#333333]">
                {isSubmitting ? 'Registering...' : 'Submit Report'}
              </button>
              <button onClick={resetForm} disabled={isSubmitting} className="px-6 bg-white border border-[#E5E5E5] text-[#1A1A1A] rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-[#F5F5F5]">
                Reset
              </button>
            </div>
          </div>
        )}

        {isDone && (
          <div className="py-12 text-center flex flex-col items-center">
            <Check className="w-10 h-10 text-[#10B981] mb-4" />
            <h3 className="text-xl font-light tracking-tight text-[#1A1A1A]">Report Logged</h3>
            <p className="text-[#10B981] text-xs font-bold uppercase tracking-widest mt-2">+10 Civic Points</p>
          </div>
        )}
      </div>
    </div>
  );
}
