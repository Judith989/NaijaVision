import json
import os
import subprocess
import tempfile
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path

import cv2
import httpx
import numpy as np
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel
from supabase import create_client

app = FastAPI(title="NaijaVision quality-control worker")
supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
worker_secret = os.environ["QC_WORKER_SECRET"]
pipeline_version = os.getenv("QC_PIPELINE_VERSION", "1.0.0")


class RecordingJob(BaseModel):
    id: str
    signed_url: str
    original_transcript: str
    language: str


class SubmissionJob(BaseModel):
    submission_id: str
    recordings: list[RecordingJob]


def media_probe(path: Path) -> dict:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def video_metrics(path: Path) -> dict:
    capture = cv2.VideoCapture(str(path))
    frame_count = 0
    frozen = 0
    brightness = []
    previous = None
    face_leak = False
    cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    face_detector = cv2.CascadeClassifier(cascade_path)
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        frame_count += 1
        if frame_count % 3:
            continue
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        brightness.append(float(gray.mean()))
        if previous is not None and np.mean(cv2.absdiff(gray, previous)) < 0.8:
            frozen += 1
        previous = gray
        if len(face_detector.detectMultiScale(gray, 1.1, 3, minSize=(50, 50))):
            face_leak = True
    capture.release()
    sampled = max(1, frame_count // 3)
    return {
        "frame_count": frame_count,
        "mean_brightness": float(np.mean(brightness)) if brightness else 0,
        "frozen_frame_ratio": frozen / sampled,
        "face_leak_detected": face_leak,
    }


def audio_metrics(path: Path) -> dict:
    result = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", "16000", "-f", "s16le", "pipe:1"],
        check=True,
        capture_output=True,
    )
    samples = np.frombuffer(result.stdout, dtype=np.int16).astype(np.float32) / 32768.0
    if not len(samples):
        return {"rms": 0, "clipping_rate": 1, "speech_activity_ratio": 0, "snr_db": 0}
    windows = np.array_split(samples, max(1, len(samples) // 1600))
    energy = np.array([np.sqrt(np.mean(window * window) + 1e-12) for window in windows])
    noise = float(np.percentile(energy, 20))
    speech = energy[energy > max(0.015, noise * 2.5)]
    speech_level = float(speech.mean()) if len(speech) else 0
    snr = 20 * np.log10(max(speech_level, 1e-6) / max(noise, 1e-6))
    return {
        "rms": float(np.sqrt(np.mean(samples * samples))),
        "clipping_rate": float(np.mean(np.abs(samples) >= 0.98)),
        "speech_activity_ratio": float(len(speech) / max(1, len(energy))),
        "snr_db": float(snr),
    }


def transcribe(path: Path) -> str | None:
    model_name = os.getenv("WHISPER_MODEL")
    if not model_name:
        return None
    from faster_whisper import WhisperModel
    model = WhisperModel(model_name, device=os.getenv("WHISPER_DEVICE", "cpu"), compute_type="int8")
    segments, _ = model.transcribe(str(path), vad_filter=True)
    return " ".join(segment.text.strip() for segment in segments).strip()


async def process(recording: RecordingJob):
    with tempfile.TemporaryDirectory() as temporary:
        path = Path(temporary) / f"{recording.id}.webm"
        async with httpx.AsyncClient(timeout=180) as client:
            response = await client.get(recording.signed_url)
            response.raise_for_status()
            path.write_bytes(response.content)
        probe = media_probe(path)
        video = video_metrics(path)
        audio = audio_metrics(path)
        transcript = transcribe(path)
        similarity = None
        if transcript:
            similarity = SequenceMatcher(None, transcript.casefold(), recording.original_transcript.casefold()).ratio()

        failures = []
        if video["mean_brightness"] < 45:
            failures.append("lighting_too_dark")
        if video["mean_brightness"] > 225:
            failures.append("lighting_too_bright")
        if video["frozen_frame_ratio"] > 0.05:
            failures.append("frozen_video")
        if video["face_leak_detected"]:
            failures.append("non_mouth_facial_region_detected")
        if audio["clipping_rate"] >= 0.01:
            failures.append("audio_clipping")
        if audio["snr_db"] < 6:
            failures.append("low_snr")
        if audio["speech_activity_ratio"] < 0.2:
            failures.append("insufficient_speech")
        if similarity is not None and similarity < 0.65:
            failures.append("prompt_mismatch")

        supabase.table("recording_quality").upsert({
            "recording_id": recording.id,
            "media_probe": probe,
            "face_leak_detected": video["face_leak_detected"],
            "speech_activity_ratio": audio["speech_activity_ratio"],
            "frozen_frame_ratio": video["frozen_frame_ratio"],
            "prompt_similarity": similarity,
            "checks_passed": not failures,
            "failure_codes": failures,
            "checked_at": datetime.now(timezone.utc).isoformat(),
            "pipeline_version": pipeline_version,
        }).execute()
        supabase.table("recordings").update({
            "quality_status": "passed" if not failures else "failed",
        }).eq("id", recording.id).execute()


@app.post("/jobs")
async def jobs(job: SubmissionJob, authorization: str | None = Header(default=None)):
    if authorization != f"Bearer {worker_secret}":
        raise HTTPException(status_code=401, detail="Invalid worker credential")
    for recording in job.recordings:
        await process(recording)
    results = supabase.table("recording_quality").select("checks_passed").in_(
        "recording_id", [recording.id for recording in job.recordings]
    ).execute().data
    passed = bool(results) and all(row["checks_passed"] for row in results)
    supabase.table("submissions").update({
        "status": "awaiting_review",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", job.submission_id).execute()
    return {"ok": True, "passed": passed, "recordings": len(job.recordings)}
