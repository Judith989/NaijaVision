"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { corePrompts, safeSpeechPrompts } from "./prompts";
import { backendConfigured, getCurrentRole, getSupabase } from "./lib/supabase";
import { sha256, uploadRecording } from "./lib/uploads";
import { AdminOperations } from "./AdminOperations";
import { BASE_PATH } from "./lib/basePath";

type Step = "welcome" | "account" | "study" | "consent" | "profile" | "calibrate" | "record" | "review" | "complete" | "reviewer";
type Clip = {
  id: string;
  promptId: string;
  transcript: string;
  language: string;
  duration: number;
  createdAt: string;
  status: "accepted" | "needs-review";
  metadata?: Record<string, string | number | boolean | null>;
  blob: Blob;
  backendRecordingId?: string;
  objectPath?: string;
};
type RecordingJoinRow = {
  id: string;
  object_path: string;
  duration_seconds: number;
  language: string;
  original_transcript?: string;
  quality_status: string;
  prompt_assignments: { prompt_id: string } | Array<{ prompt_id: string }> | null;
};
type RecordingReviewRow = { recording_id: string; decision: "approved" | "rejected" | "changes_requested" };
type ReviewerPaymentRow = { reviewed_video_count: number; rate_per_video: number; amount: number; currency: string; status: string };

function joinedPromptId(row: RecordingJoinRow) {
  return Array.isArray(row.prompt_assignments) ? row.prompt_assignments[0]?.prompt_id || "" : row.prompt_assignments?.prompt_id || "";
}

const languages = ["Igbo", "Yorùbá", "Hausa", "Nigerian Pidgin", "Nigerian English"];
const countries = ["Nigeria", "Ghana", "Cameroon", "Benin", "Togo", "Other"];
const educationOptions = ["No formal education", "Primary", "Secondary", "Vocational", "Bachelor's", "Master's", "Doctorate", "Other"];
const deviceTypes = ["Smartphone", "Tablet", "Laptop", "Desktop", "External Camera", "Other"];
const operatingSystems = ["Android", "iOS", "Windows", "macOS", "Linux", "Other"];
const accessibilityOptions = ["Screen reader", "Voice control", "Hearing aid", "Captioning", "None", "Other"];
const fallbackNigerianBanks = [
  { name: "Access Bank", code: "044" }, { name: "Citibank Nigeria", code: "023" },
  { name: "Ecobank Nigeria", code: "050" }, { name: "Fidelity Bank", code: "070" },
  { name: "First Bank of Nigeria", code: "011" }, { name: "First City Monument Bank", code: "214" },
  { name: "Guaranty Trust Bank", code: "058" }, { name: "Jaiz Bank", code: "301" },
  { name: "Keystone Bank", code: "082" }, { name: "Polaris Bank", code: "076" },
  { name: "Providus Bank", code: "101" }, { name: "Stanbic IBTC Bank", code: "221" },
  { name: "Standard Chartered Bank", code: "068" }, { name: "Sterling Bank", code: "232" },
  { name: "United Bank for Africa", code: "033" }, { name: "Union Bank of Nigeria", code: "032" },
  { name: "Unity Bank", code: "215" }, { name: "Wema Bank", code: "035" },
  { name: "Zenith Bank", code: "057" },
];
const PER_LANGUAGE_COMPENSATION = { amount: 500, currency: "NGN" };
const MIN_LIGHT_LEVEL = 25;
const MAX_LIGHT_LEVEL = 240;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("naijavision-local", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("clips")) db.createObjectStore("clips", { keyPath: "id" });
      if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveClip(clip: Clip) {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("clips", "readwrite");
    tx.objectStore("clips").put(clip);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function compactStoredCloudClips() {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("clips", "readwrite");
    const store = tx.objectStore("clips");
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const clip = cursor.value as Clip;
      if (clip.backendRecordingId && clip.blob?.size) cursor.update({ ...clip, blob: new Blob([]) });
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

function readableError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const value = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    return [value.message, value.details, value.hint, value.code].filter((item) => typeof item === "string" && item).join(" ") || "Unknown storage error";
  }
  return String(error || "Unknown storage error");
}

async function loadClips(): Promise<Clip[]> {
  const db = await openDatabase();
  const result = await new Promise<Clip[]>((resolve, reject) => {
    const req = db.transaction("clips").objectStore("clips").getAll();
    req.onsuccess = () => resolve(req.result as Clip[]);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result;
}

async function deleteClip(id: string) {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("clips", "readwrite");
    tx.objectStore("clips").delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

function Mark({ children }: { children: React.ReactNode }) {
  return <span className="mark">{children}</span>;
}

function MultiSelect({ options, value, onChange }: { options: string[]; value: string[]; onChange: (next: string[]) => void }) {
  return <div className="multi-select">{options.map((option) => <label key={option}><input type="checkbox" checked={value.includes(option)} onChange={() => onChange(value.includes(option) ? value.filter((item) => item !== option) : [...value, option])} /><span>{option}</span></label>)}</div>;
}

export default function Home() {
  const [step, setStep] = useState<Step>("welcome");
  const [calibrationReturnStep, setCalibrationReturnStep] = useState<"profile" | "record">("profile");
  const [account, setAccount] = useState({ contactMethod: "Email", contact: "", payoutCountry: "Nigeria", bankName: "", bankCode: "", accountName: "", accountNumber: "" });
  const [authRequested, setAuthRequested] = useState(false);
  const [authCode, setAuthCode] = useState("");
  const [authVerified, setAuthVerified] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [nigerianBanks, setNigerianBanks] = useState(fallbackNigerianBanks);
  const [bankVerified, setBankVerified] = useState(false);
  const [verifyingBank, setVerifyingBank] = useState(false);
  const [paymentEditMode, setPaymentEditMode] = useState(false);
  const [savedAccountLast4, setSavedAccountLast4] = useState("");
  const [authenticatedUserId, setAuthenticatedUserId] = useState("");
  const [currentRole, setCurrentRole] = useState<"participant" | "reviewer" | "admin">("participant");
  const [consent, setConsent] = useState({ adult: false, informed: false, publicUse: false });
  const [harmful, setHarmful] = useState(false);
  const [lgas, setLgas] = useState<Record<string, string[]>>({});
  const [profile, setProfile] = useState({
    code: `NV-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, participationDate: new Date().toISOString(),
    country: "Nigeria", otherCountry: "", state: "", lga: "", residence: "Urban",
    age: "25–34", gender: "Prefer not to say", genderOther: "", education: "", occupation: "",
    nativeLanguages: ["Igbo"] as string[], otherLanguages: [] as string[], primary: "Igbo", homeLanguage: "", workLanguage: "", dailyLanguages: [] as string[], dialect: "",
    canRead: "Yes", canWrite: "Yes", switchingFrequency: "Sometimes", mixedLanguages: "",
    speechImpairment: "No", speechDescription: "", hearingImpairment: "No", glasses: "No", faceCovering: "Never",
    deviceType: "Laptop", operatingSystem: "", deviceBrand: "", deviceModel: "", cameraResolution: "", microphoneType: "Built-in",
    deviceAge: "1–2 years", deviceOwnership: "Personal", deviceFrequency: "Daily",
    recordingLocation: "Home", noiseLevel: "Quiet", lighting: "Indoor lighting", internet: "Wi-Fi",
    accessibility: ["None"] as string[],
    feedbackEase: "", technicalProblems: "", comments: "",
  });
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState("");
  const [calibrating, setCalibrating] = useState(false);
  const [cameraPassed, setCameraPassed] = useState(false);
  const [audioPassed, setAudioPassed] = useState(false);
  const [lightingPassed, setLightingPassed] = useState(false);
  const [audioMetrics, setAudioMetrics] = useState({ sampleRate: 0, peak: 0, noise: 0, snr: 0, clipping: 0 });
  const [lightLevel, setLightLevel] = useState(0);
  const [calibrationMessage, setCalibrationMessage] = useState("Enable the camera and microphone to begin.");
  const [promptIndex, setPromptIndex] = useState(0);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [preview, setPreview] = useState<{ url: string; blob: Blob; duration: number } | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [qualityConfirm, setQualityConfirm] = useState<string[]>([]);
  const [toast, setToast] = useState("");
  const [reportingPromptIssue, setReportingPromptIssue] = useState(false);
  const [promptIssueText, setPromptIssueText] = useState("");
  const [promptIssueSending, setPromptIssueSending] = useState(false);
  const [savingRecording, setSavingRecording] = useState(false);
  const [redoPromptIds, setRedoPromptIds] = useState<string[] | null>(null);
  const [reviewStatus, setReviewStatus] = useState<"pending" | "approved" | "changes-requested" | "declined">("pending");
  const [paymentStatus, setPaymentStatus] = useState<"not-eligible" | "eligible" | "approved">("not-eligible");
  const [reviewMedia, setReviewMedia] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [submissionId, setSubmissionId] = useState("");
  const [reviewQueue, setReviewQueue] = useState<Array<{ id: string; user_id: string; participant_id: string; status: string; expected_recordings: number; created_at: string; assigned_reviewer_id: string | null }>>([]);
  const [selectedReviewId, setSelectedReviewId] = useState("");
  const [reviewRecommendation, setReviewRecommendation] = useState<{ recommendation: "approved" | "rejected" | "changes_requested"; comments: string; admin_review_status: "pending" | "returned" | "accepted" | "participant_returned"; admin_feedback: string | null } | null>(null);
  const [reviewComments, setReviewComments] = useState("");
  const [adminDecisionComments, setAdminDecisionComments] = useState("");
  const [adminWorkspaceView, setAdminWorkspaceView] = useState<"reviews" | "operations">("reviews");
  const [reviewerRecords, setReviewerRecords] = useState<Array<{ id: string; prompt_id: string; language: string; duration_seconds: number; quality_status: string; object_path: string; signed_url: string; review_decision?: "approved" | "rejected" | "changes_requested" }>>([]);
  const [reviewerPayments, setReviewerPayments] = useState<ReviewerPaymentRow[]>([]);
  const [reviewerRate, setReviewerRate] = useState({ amount: 10, currency: "NGN" });
  const [reviewerPayout, setReviewerPayout] = useState<{ bank_name: string; account_last4: string; verified_at: string | null } | null>(null);
  const [localRecordingReviews, setLocalRecordingReviews] = useState<Record<string, "approved" | "rejected" | "changes_requested">>({});
  const [withdrawalReason, setWithdrawalReason] = useState("");
  const [withdrawalRequested, setWithdrawalRequested] = useState(false);
  const [backendSubmissionStatus, setBackendSubmissionStatus] = useState("");
  const [notifications, setNotifications] = useState<Array<{ id: string; title: string; message: string; created_at: string }>>([]);
  const [compensation, setCompensation] = useState<{ amount: number; currency: string } | null>(null);
  const [earnedCompensation, setEarnedCompensation] = useState<{ amount: number; currency: string; completedLanguages: number; standardLanguages?: number; safeSpeechLanguages?: number } | null>(null);
  const [hasDraft, setHasDraft] = useState(false);
  const sourceVideoRef = useRef<HTMLVideoElement>(null);
  const mouthCanvasRef = useRef<HTMLCanvasElement>(null);
  const mouthPreviewRef = useRef<HTMLCanvasElement>(null);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const calibrationFrameRef = useRef<number | null>(null);
  const calibrationRunRef = useRef(0);
  const processedAudioNodesRef = useRef<AudioNode[]>([]);
  const faceStableFramesRef = useRef(0);
  const speechFramesRef = useRef(0);
  const lightStableFramesRef = useRef(0);
  const processedStreamRef = useRef<MediaStream | null>(null);
  const recordingCanvasTrackRef = useRef<CanvasCaptureMediaStreamTrack | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { loadClips().then((items) => setClips(items.filter((clip) => clip.metadata?.sessionId === profile.code))).catch(() => undefined); }, [profile.code]);
  useEffect(() => { fetch(`${BASE_PATH}/nigeria-lgas.json`).then((response) => response.json()).then(setLgas).catch(() => setLgas({})); }, []);
  useEffect(() => { queueMicrotask(() => setHasDraft(Boolean(localStorage.getItem("naijavision-contribution-draft")))); }, []);
  useEffect(() => { queueMicrotask(() => { setReportingPromptIssue(false); setPromptIssueText(""); }); }, [promptIndex]);
  useEffect(() => {
    if (step !== "account" || !authenticatedUserId) return;
    const supabase = getSupabase();
    if (!supabase) return;
    supabase.functions.invoke("list-nigerian-banks").then(({ data }) => {
      if (Array.isArray(data?.banks) && data.banks.length) setNigerianBanks(data.banks);
    });
  }, [step, authenticatedUserId]);
  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;
    supabase.auth.getUser().then(async ({ data }) => {
      const requestedMode = new URLSearchParams(window.location.search);
      const editingPayment = requestedMode.get("payment") === "edit";
      setPaymentEditMode(editingPayment);
      if (!data.user) {
        if (requestedMode.get("contribute") === "1" || requestedMode.get("reviewer") === "1") window.location.replace(`${BASE_PATH}/signin?next=/dashboard`);
        return;
      }
      setAuthenticatedUserId(data.user.id);
      setAuthVerified(true);
      setAccount((current) => ({ ...current, contactMethod: data.user.email ? "Email" : "Phone number", contact: data.user.email || data.user.phone || current.contact }));
      const role = await getCurrentRole();
      setCurrentRole(role);
      if (requestedMode.get("contribute") === "1") {
        const { data: latestSubmission } = await supabase
          .from("submissions")
          .select("id,status,survey_id,consent_id,compensation_amount,compensation_currency,completed_language_count,completed_standard_language_count,completed_safe_speech_language_count")
          .eq("user_id", data.user.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const resumableStatuses = ["draft", "recording", "uploading", "changes_requested", "resubmitted"];
        const activeSubmission = latestSubmission && resumableStatuses.includes(latestSubmission.status) ? latestSubmission : null;
        if (latestSubmission) setEarnedCompensation({ amount: Number(latestSubmission.compensation_amount || 0), currency: latestSubmission.compensation_currency || "NGN", completedLanguages: Number(latestSubmission.completed_language_count || 0), standardLanguages: Number(latestSubmission.completed_standard_language_count || 0), safeSpeechLanguages: Number(latestSubmission.completed_safe_speech_language_count || 0) });
        const awaitingDecisionStatuses = ["submitted", "automated_qc", "awaiting_review", "payment_eligible", "payment_processing"];
        if (latestSubmission && awaitingDecisionStatuses.includes(latestSubmission.status)) {
          window.location.replace(`${BASE_PATH}/dashboard#review-status`);
          return;
        }
        let savedResponses: Record<string, unknown> | null = null;
        let savedConsent: { safe_speech_opt_in: boolean; consent_version_id: string } | null = null;
        if (latestSubmission) {
          const [{ data: savedSurvey }, { data: savedConsentRow }] = await Promise.all([
            supabase.from("surveys").select("responses").eq("id", latestSubmission.survey_id).maybeSingle(),
            supabase.from("consents").select("safe_speech_opt_in,consent_version_id").eq("id", latestSubmission.consent_id).maybeSingle(),
          ]);
          savedResponses = savedSurvey?.responses || null;
          savedConsent = savedConsentRow;
          if (savedResponses) setProfile((current) => ({ ...current, ...savedResponses }));
          if (savedConsent) {
            setHarmful(Boolean(savedConsent.safe_speech_opt_in));
            setConsent({ adult: true, informed: true, publicUse: true });
          }
        }
        if (activeSubmission) {
          setSubmissionId(activeSubmission.id);
          await hydrateSubmissionRecordings(activeSubmission.id, activeSubmission.status, String(savedResponses?.code || profile.code));
        }
        const { data: savedPayout } = await supabase
          .from("payout_accounts")
          .select("country,bank_code,bank_name,account_name,account_last4,verified_at")
          .eq("user_id", data.user.id)
          .maybeSingle();
        if (savedPayout?.verified_at && requestedMode.get("payment") !== "edit") {
          setAccount((current) => ({
            ...current,
            payoutCountry: savedPayout.country,
            bankCode: savedPayout.bank_code,
            bankName: savedPayout.bank_name,
            accountName: savedPayout.account_name,
            accountNumber: savedPayout.account_last4,
          }));
          setBankVerified(true);
          if (activeSubmission) openCalibration("record");
          else if (latestSubmission && ["paid", "rejected", "withdrawn"].includes(latestSubmission.status) && savedResponses && savedConsent) {
            const { data: newSubmissionId, error: startError } = await supabase.rpc("start_next_submission");
            if (startError) {
              if (startError.message.toLowerCase().includes("consent renewal")) setStep("study");
              else {
                setToast(`A new contribution could not be started: ${startError.message}`);
                setStep("welcome");
              }
            } else {
              setSubmissionId(newSubmissionId);
              setPromptIndex(0);
              openCalibration("record");
            }
          } else setStep("study");
        } else {
          if (savedPayout) {
            setSavedAccountLast4(savedPayout.account_last4);
            setAccount((current) => ({
              ...current,
              payoutCountry: savedPayout.country,
              bankCode: savedPayout.bank_code,
              bankName: savedPayout.bank_name,
              accountName: savedPayout.account_name,
              accountNumber: "",
            }));
          }
          setBankVerified(false);
          setStep("account");
        }
      }
      if (requestedMode.get("reviewer") === "1" && (role === "reviewer" || role === "admin")) {
        if (role === "admin" && requestedMode.get("workspace") === "admin") setAdminWorkspaceView("operations");
        setStep("reviewer");
      }
      const { data: policy } = await supabase.from("compensation_policies").select("amount,currency").is("retired_at", null).order("effective_at", { ascending: false }).limit(1).maybeSingle();
      if (policy) setCompensation(policy);
    });
    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!session?.user) return;
      setAuthenticatedUserId(session.user.id);
      setAuthVerified(true);
      setCurrentRole(await getCurrentRole());
      const { data: policy } = await supabase.from("compensation_policies").select("amount,currency").is("retired_at", null).order("effective_at", { ascending: false }).limit(1).maybeSingle();
      if (policy) setCompensation(policy);
    });
    return () => listener.subscription.unsubscribe();
    // Authentication bootstrap runs once and then uses Supabase's auth listener.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (step !== "reviewer") return;
    const supabase = getSupabase();
    if (!supabase) return;
    let query = supabase.from("submissions")
      .select("id,user_id,participant_id,status,expected_recordings,created_at,assigned_reviewer_id")
      .in("status", ["automated_qc", "awaiting_review", "resubmitted", "payment_eligible", "payment_processing"])
      .order("created_at", { ascending: true });
    if (currentRole === "reviewer" && authenticatedUserId) query = query.eq("assigned_reviewer_id", authenticatedUserId);
    query.then(({ data }) => {
        const queue = currentRole === "reviewer"
          ? (data || []).filter((submission) => submission.user_id !== authenticatedUserId)
          : data || [];
        setReviewQueue(queue);
      });
  }, [step, selectedReviewId, currentRole, authenticatedUserId]);
  useEffect(() => {
    if (step !== "reviewer" || !authenticatedUserId || !backendConfigured) return;
    const supabase = getSupabase();
    if (!supabase) return;
    Promise.all([
      supabase.from("reviewer_payments").select("reviewed_video_count,rate_per_video,amount,currency,status").eq("reviewer_id", authenticatedUserId),
      supabase.from("reviewer_compensation_policies").select("amount_per_video,currency").is("retired_at", null).order("effective_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("payout_accounts").select("bank_name,account_last4,verified_at").eq("user_id", authenticatedUserId).maybeSingle(),
    ]).then(([paymentResult, policyResult, payoutResult]) => {
      setReviewerPayments((paymentResult.data || []).map((row) => ({ ...row, reviewed_video_count: Number(row.reviewed_video_count), rate_per_video: Number(row.rate_per_video), amount: Number(row.amount) })) as ReviewerPaymentRow[]);
      if (policyResult.data) setReviewerRate({ amount: Number(policyResult.data.amount_per_video), currency: policyResult.data.currency });
      setReviewerPayout(payoutResult.data || null);
    });
  }, [step, authenticatedUserId]);
  useEffect(() => {
    if (!backendConfigured || !selectedReviewId) return;
    const supabase = getSupabase();
    if (!supabase) return;
    supabase.from("recordings")
      .select("id,language,duration_seconds,quality_status,object_path,prompt_assignments(prompt_id)")
      .eq("submission_id", selectedReviewId)
      .then(async ({ data }) => {
        const rows = data || [];
        const { data: savedReviews } = await supabase.from("reviews")
          .select("recording_id,reviewer_id,decision,reviewed_at")
          .eq("submission_id", selectedReviewId)
          .order("reviewed_at", { ascending: false });
        const decisionByRecording = new Map<string, "approved" | "rejected" | "changes_requested">();
        for (const review of savedReviews || []) {
          if (currentRole === "reviewer" && review.reviewer_id !== authenticatedUserId) continue;
          if (review.recording_id && !decisionByRecording.has(review.recording_id)) decisionByRecording.set(review.recording_id, review.decision);
        }
        const signed = await Promise.all((rows as unknown as RecordingJoinRow[]).map(async (row) => {
          const { data: url } = await supabase.storage.from("raw-recordings").createSignedUrl(row.object_path, 900);
          return {
            id: row.id,
            prompt_id: joinedPromptId(row),
            language: row.language,
            duration_seconds: row.duration_seconds,
            quality_status: row.quality_status,
            object_path: row.object_path,
            signed_url: url?.signedUrl || "",
            review_decision: decisionByRecording.get(row.id),
          };
        }));
        setReviewerRecords(signed);
      });
  }, [selectedReviewId, currentRole, authenticatedUserId]);
  useEffect(() => {
    if (!backendConfigured || !selectedReviewId) return;
    const supabase = getSupabase();
    if (!supabase) return;
    supabase.from("submission_recommendations")
      .select("recommendation,comments,admin_review_status,admin_feedback")
      .eq("submission_id", selectedReviewId)
      .maybeSingle()
      .then(({ data }) => setReviewRecommendation(data as typeof reviewRecommendation));
  }, [selectedReviewId]);
  useEffect(() => {
    if (step !== "complete" || !submissionId || !backendConfigured) return;
    const supabase = getSupabase();
    if (!supabase) return;
    let active = true;
    const refresh = async () => {
      const { data } = await supabase.from("submissions").select("status").eq("id", submissionId).single();
      if (active && data) setBackendSubmissionStatus(data.status);
      const { data: notices } = await supabase.from("notifications").select("id,title,message,created_at").is("read_at", null).order("created_at", { ascending: false });
      if (active) setNotifications(notices || []);
    };
    refresh();
    const timer = setInterval(refresh, 15000);
    return () => { active = false; clearInterval(timer); };
  }, [step, submissionId]);
  useEffect(() => {
    if (sourceVideoRef.current && stream) {
      sourceVideoRef.current.srcObject = stream;
      sourceVideoRef.current.play().catch(() => undefined);
    }
  }, [stream, step]);
  useEffect(() => () => {
    stream?.getTracks().forEach((track) => track.stop());
  }, [stream]);
  useEffect(() => () => {
    calibrationRunRef.current += 1;
    processedStreamRef.current?.getTracks().forEach((track) => track.stop());
    if (calibrationFrameRef.current) cancelAnimationFrame(calibrationFrameRef.current);
    processedAudioNodesRef.current.forEach((node) => node.disconnect());
    processedAudioNodesRef.current = [];
    faceLandmarkerRef.current?.close();
    audioContextRef.current?.close();
  }, []);

  const selectedLanguages = useMemo(() => new Set([
    profile.primary,
    profile.homeLanguage,
    profile.workLanguage,
    ...profile.nativeLanguages,
    ...profile.otherLanguages,
    ...profile.dailyLanguages,
  ].filter(Boolean)), [profile]);
  const prompts = useMemo(() => {
    const eligible = corePrompts.filter((prompt) => {
      if (prompt.type === "Natural speech") return selectedLanguages.size > 0;
      if (prompt.type === "Numbers and names") return selectedLanguages.has("Nigerian English");
      if (prompt.type === "Reading") return selectedLanguages.has(prompt.language);
      if (prompt.type === "Code-switching") {
        const required = prompt.language.split("+").map((language) => language.trim());
        return required.every((language) => selectedLanguages.has(language));
      }
      return false;
    });
    if (!harmful) return redoPromptIds ? eligible.filter((prompt) => redoPromptIds.includes(prompt.id)) : eligible;
    const safe = safeSpeechPrompts.filter((prompt) => {
      const required = prompt.language.split("+").map((language) => language.trim());
      return required.every((language) => selectedLanguages.has(language));
    });
    const allEligible = [...eligible, ...safe];
    return redoPromptIds ? allEligible.filter((prompt) => redoPromptIds.includes(prompt.id)) : allEligible;
  }, [harmful, selectedLanguages, redoPromptIds]);
  const assignedTasks = useMemo(() => Array.from(new Set([
    "Lip movement recording",
    ...prompts.map((prompt) => {
      if (prompt.type === "Natural speech") return "Free speech";
      if (prompt.type === "Code-switching") return "Code-switching tasks";
      if (prompt.type === "NaijaSafeSpeech") return "NaijaSafeSpeech reading";
      return "Reading prompted sentences";
    }),
  ])), [prompts]);
  const current = prompts[promptIndex];
  useEffect(() => {
    if (step !== "record" || preview || !current || !clips.some((clip) => clip.promptId === current.id)) return;
    const missingIndex = prompts.findIndex((prompt) => !clips.some((clip) => clip.promptId === prompt.id));
    if (missingIndex >= 0 && missingIndex !== promptIndex) queueMicrotask(() => setPromptIndex(missingIndex));
  }, [step, preview, current, clips, prompts, promptIndex]);
  const consentReady = Object.values(consent).every(Boolean);
  const acceptedCount = clips.filter((c) => c.status === "accepted").length;
  const progress = Math.min(100, (acceptedCount / prompts.length) * 100);
  const compensationRate = compensation || PER_LANGUAGE_COMPENSATION;
  const potentialCompensation = { ...compensationRate, amount: compensationRate.amount * selectedLanguages.size * (harmful ? 2 : 1) };
  const displayedEarnings = earnedCompensation || { amount: 0, currency: compensationRate.currency, completedLanguages: 0 };

  function saveDraftAndExit() {
    localStorage.setItem("naijavision-contribution-draft", JSON.stringify({
      profile,
      harmful,
      promptIndex,
      submissionId,
      savedAt: new Date().toISOString(),
    }));
    setHasDraft(true);
    calibrationRunRef.current += 1;
    if (calibrationFrameRef.current !== null) cancelAnimationFrame(calibrationFrameRef.current);
    calibrationFrameRef.current = null;
    processedAudioNodesRef.current.forEach((node) => node.disconnect());
    processedAudioNodesRef.current = [];
    stream?.getTracks().forEach((track) => track.stop());
    processedStreamRef.current?.getTracks().forEach((track) => track.stop());
    processedStreamRef.current = null;
    setStream(null);
    setCameraPassed(false);
    setAudioPassed(false);
    setLightingPassed(false);
    setStep("welcome");
  }

  function resumeDraft() {
    const raw = localStorage.getItem("naijavision-contribution-draft");
    if (!raw) return;
    try {
      const draft = JSON.parse(raw);
      if (draft.profile) setProfile(draft.profile);
      setHarmful(Boolean(draft.harmful));
      setPromptIndex(Number(draft.promptIndex) || 0);
      setSubmissionId(String(draft.submissionId || ""));
      openCalibration("record");
    } catch {
      localStorage.removeItem("naijavision-contribution-draft");
      setHasDraft(false);
    }
  }

  function returnToRecording() {
    const missingIndex = prompts.findIndex((prompt) => !clips.some((clip) => clip.promptId === prompt.id));
    setPromptIndex(missingIndex >= 0 ? missingIndex : Math.min(promptIndex, prompts.length - 1));
    setStep("record");
  }

  function openCalibration(returnStep: "profile" | "record") {
    if (recording) {
      setToast("Stop the current recording before recalibrating equipment.");
      return;
    }
    calibrationRunRef.current += 1;
    if (calibrationFrameRef.current !== null) cancelAnimationFrame(calibrationFrameRef.current);
    calibrationFrameRef.current = null;
    processedAudioNodesRef.current.forEach((node) => node.disconnect());
    processedAudioNodesRef.current = [];
    stream?.getTracks().forEach((track) => track.stop());
    processedStreamRef.current?.getTracks().forEach((track) => track.stop());
    processedStreamRef.current = null;
    recordingCanvasTrackRef.current = null;
    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    analyserRef.current = null;
    faceLandmarkerRef.current?.close();
    faceLandmarkerRef.current = null;
    setStream(null);
    setCameraPassed(false);
    setAudioPassed(false);
    setLightingPassed(false);
    setLightLevel(0);
    setCalibrating(false);
    setCalibrationMessage("Enable the camera and microphone to begin.");
    setCalibrationReturnStep(returnStep);
    setStep("calibrate");
  }

  async function hydrateSubmissionRecordings(activeId: string, status: string, sessionCode: string) {
    const supabase = getSupabase();
    if (!supabase) return;
    const { data: rows, error } = await supabase
      .from("recordings")
      .select("id,object_path,duration_seconds,language,original_transcript,quality_status,prompt_assignments(prompt_id)")
      .eq("submission_id", activeId);
    if (error) {
      setToast("Saved recordings could not be loaded. Please refresh and try again.");
      return;
    }

    if (status === "changes_requested") {
      const { data: reviewRows } = await supabase
        .from("reviews")
        .select("recording_id,decision")
        .eq("submission_id", activeId)
        .in("decision", ["rejected", "changes_requested"]);
      const typedRows = (rows || []) as unknown as RecordingJoinRow[];
      const redoRecordingIds = new Set(((reviewRows || []) as RecordingReviewRow[]).map((review) => review.recording_id));
      const redoIds = typedRows
        .filter((row) => redoRecordingIds.has(row.id))
        .map(joinedPromptId)
        .filter(Boolean);
      const legacyFallbackIds = typedRows.map(joinedPromptId).filter(Boolean);
      setRedoPromptIds(redoIds.length ? redoIds : legacyFallbackIds);
      setClips([]);
      setPromptIndex(0);
      return;
    }

    setRedoPromptIds(null);
    const restored = ((rows || []) as unknown as RecordingJoinRow[]).map((row) => {
      const promptId = joinedPromptId(row);
      const clip: Clip = {
        id: row.id,
        promptId,
        transcript: row.original_transcript || "",
        language: row.language,
        duration: Number(row.duration_seconds),
        createdAt: new Date().toISOString(),
        status: row.quality_status === "needs-review" ? "needs-review" : "accepted",
        metadata: { sessionId: sessionCode, humanValidationStatus: "pending" },
        blob: new Blob([]),
        backendRecordingId: row.id,
        objectPath: row.object_path,
      };
      return clip;
    });
    setClips(restored);
    void compactStoredCloudClips().catch(() => undefined);
  }

  async function persistAcceptedClip(clip: Clip): Promise<Clip> {
    const supabase = getSupabase();
    if (!supabase || !authenticatedUserId || !submissionId) return clip;
    const { data: assignment, error: assignmentError } = await supabase
      .from("prompt_assignments")
      .select("id")
      .eq("submission_id", submissionId)
      .eq("prompt_id", clip.promptId)
      .maybeSingle();
    if (assignmentError) throw assignmentError;
    let assignmentId = assignment?.id;
    if (!assignmentId) {
      const { data: repairedAssignmentId, error: repairError } = await supabase.rpc("ensure_prompt_assignment", {
        p_submission_id: submissionId,
        p_prompt_id: clip.promptId,
      });
      if (repairError || !repairedAssignmentId) throw repairError || new Error(`Could not assign prompt ${clip.promptId}`);
      assignmentId = String(repairedAssignmentId);
    }

    const { data: existing } = await supabase
      .from("recordings")
      .select("id,object_path")
      .eq("submission_id", submissionId)
      .eq("prompt_assignment_id", assignmentId)
      .maybeSingle();
    const newRecordingId = crypto.randomUUID();
    const checksum = await sha256(clip.blob);
    const objectPath = await uploadRecording(authenticatedUserId, submissionId, newRecordingId, clip.blob, ({ percentage }) => setUploadProgress(percentage));
    const payload = {
      object_path: objectPath,
      checksum_sha256: checksum,
      content_type: (clip.blob.type || "video/webm").split(";", 1)[0].trim().toLowerCase(),
      file_size: clip.blob.size,
      duration_seconds: clip.duration,
      language: clip.language,
      original_transcript: clip.transcript,
      normalized_transcript: clip.transcript.toLocaleLowerCase(),
      video_width: clip.metadata?.width || null,
      video_height: clip.metadata?.height || null,
      frame_rate: clip.metadata?.frameRate || null,
      audio_sample_rate: clip.metadata?.audioSampleRate || null,
      device_orientation: clip.metadata?.deviceOrientation || null,
      browser: clip.metadata?.browser || null,
      operating_system: clip.metadata?.operatingSystem || null,
      device_category: clip.metadata?.deviceCategory || null,
      device_model: clip.metadata?.deviceModel || null,
      recording_location: clip.metadata?.recordingEnvironment || null,
      lighting_condition: clip.metadata?.lightingCondition || null,
      measured_light_level: clip.metadata?.measuredLightLevel || null,
      estimated_noise: clip.metadata?.estimatedNoiseLevel || null,
      snr_db: clip.metadata?.measuredSnrDb || null,
      clipping_rate: clip.metadata?.clippingRate || null,
      speaking_style: clip.metadata?.speakingStyle || null,
      dialect: clip.metadata?.dialect || null,
      language_sequence: clip.metadata?.codeSwitchLanguageSequence ? String(clip.metadata.codeSwitchLanguageSequence).split("+").map((value) => value.trim()) : [clip.language],
      english_translation: clip.metadata?.englishTranslation || null,
      quality_status: "pending",
      human_validation_status: "pending",
    };

    const result = existing
      ? await supabase.from("recordings").update(payload).eq("id", existing.id)
      : await supabase.from("recordings").insert({
          id: newRecordingId,
          submission_id: submissionId,
          user_id: authenticatedUserId,
          prompt_assignment_id: assignmentId,
          ...payload,
        });
    if (result.error) {
      await supabase.storage.from("raw-recordings").remove([objectPath]);
      throw result.error;
    }
    if (existing?.object_path && existing.object_path !== objectPath) {
      await supabase.storage.from("raw-recordings").remove([existing.object_path]);
    }
    setUploadProgress(0);
    return { ...clip, id: existing?.id || newRecordingId, backendRecordingId: existing?.id || newRecordingId, objectPath };
  }

  async function removeAcceptedClip(clip: Clip) {
    const supabase = getSupabase();
    if (supabase && clip.backendRecordingId) {
      const { error } = await supabase.from("recordings").delete().eq("id", clip.backendRecordingId);
      if (error) throw error;
      if (clip.objectPath) await supabase.storage.from("raw-recordings").remove([clip.objectPath]);
    }
    await deleteClip(clip.id);
    setClips((items) => items.filter((item) => item.id !== clip.id));
  }

  async function getRecordingBlob(clip: Clip) {
    if (clip.blob?.size) return clip.blob;
    const supabase = getSupabase();
    if (!supabase || !clip.objectPath) throw new Error("The recording file is not available on this device.");
    const { data, error } = await supabase.storage.from("raw-recordings").download(clip.objectPath);
    if (error || !data) throw error || new Error("The recording could not be downloaded from storage.");
    return data;
  }

  async function submitPromptIssue() {
    const issue = promptIssueText.trim();
    if (!issue || !current) return;
    setPromptIssueSending(true);
    const supabase = getSupabase();
    if (supabase && authenticatedUserId) {
      const { error } = await supabase.from("prompt_issue_reports").insert({
        user_id: authenticatedUserId,
        submission_id: submissionId || null,
        prompt_id: current.id,
        issue_text: issue,
      });
      if (error) {
        setPromptIssueSending(false);
        setToast("The prompt report could not be sent. Please try again.");
        setTimeout(() => setToast(""), 3000);
        return;
      }
    }
    setPromptIssueSending(false);
    setReportingPromptIssue(false);
    setPromptIssueText("");
    setToast("Prompt issue submitted for review.");
    setTimeout(() => setToast(""), 2500);
  }

  async function requestAccountVerification() {
    const supabase = getSupabase();
    if (!supabase) {
      setAuthVerified(true);
      setAuthMessage("Local development mode: verification is simulated.");
      return;
    }
    setAuthMessage("Sending verification code...");
    const options = account.contactMethod === "Email"
      ? { email: account.contact }
      : { phone: account.contact };
    const { error } = await supabase.auth.signInWithOtp(options);
    if (error) {
      setAuthMessage(error.message);
      return;
    }
    setAuthRequested(true);
    setAuthMessage(`A verification code was sent to your ${account.contactMethod.toLowerCase()}.`);
  }

  async function verifyAccountCode() {
    const supabase = getSupabase();
    if (!supabase) {
      setAuthVerified(true);
      return;
    }
    const verification = account.contactMethod === "Email"
      ? { email: account.contact, token: authCode, type: "email" as const }
      : { phone: account.contact, token: authCode, type: "sms" as const };
    const { data, error } = await supabase.auth.verifyOtp(verification);
    if (error || !data.user) {
      setAuthMessage(error?.message || "Verification failed.");
      return;
    }
    setAuthenticatedUserId(data.user.id);
    setAuthVerified(true);
    setAuthMessage("Contact verified.");
  }

  async function handleStaffSignOut() {
    const supabase = getSupabase();
    if (supabase) await supabase.auth.signOut();
    setCurrentRole("participant");
    setAuthenticatedUserId("");
    setAuthVerified(false);
    setStep("welcome");
  }

  async function verifyPayoutAccount() {
    const supabase = getSupabase();
    if (!supabase) return;
    setVerifyingBank(true);
    setAuthMessage("Verifying the account with the selected bank...");
    const { data, error } = await supabase.functions.invoke("tokenize-payout-account", {
        body: {
          country: account.payoutCountry,
          bankName: account.bankName,
          bankCode: account.bankCode,
          accountNumber: account.accountNumber,
        },
      });
    setVerifyingBank(false);
    if (error || data?.error) {
      setBankVerified(false);
      setAuthMessage(`Bank details could not be verified: ${data?.error || error?.message || "Verification failed."}`);
      return;
    }
    setAccount((current) => ({ ...current, accountName: data.accountName || current.accountName }));
    setBankVerified(true);
    setAuthMessage(`Verified account: ${data.accountName || "Account confirmed"}.`);
  }

  async function savePayoutAndContinue() {
    if (!bankVerified) {
      setAuthMessage("Verify the bank account before continuing.");
      return;
    }
    if (paymentEditMode) {
      window.location.assign(`${BASE_PATH}/dashboard`);
      return;
    }
    setStep("study");
  }

  async function prepareBackendSubmission() {
    const supabase = getSupabase();
    if (!supabase) {
      setPromptIndex(0);
      openCalibration("profile");
      return;
    }
    if (submissionId) {
      const { error: resumeError } = await supabase.rpc("resume_submission", {
        p_submission_id: submissionId,
        p_safe_speech_opt_in: harmful,
        p_survey: { ...profile, tasks: assignedTasks },
        p_languages: Array.from(selectedLanguages),
      });
      if (resumeError) {
        setToast("We could not resume your contribution. Please refresh and try again.");
        return;
      }
      setPromptIndex(0);
      openCalibration("profile");
      return;
    }
    const { data: version, error: versionError } = await supabase
      .from("consent_versions")
      .select("id")
      .is("retired_at", null)
      .order("effective_at", { ascending: false })
      .limit(1)
      .single();
    if (versionError || !version) {
      setToast("We could not start your contribution. Please try again in a moment or contact support.");
      return;
    }
    const { data, error } = await supabase.rpc("begin_submission", {
      p_consent_version_id: version.id,
      p_safe_speech_opt_in: harmful,
      p_survey: { ...profile, tasks: assignedTasks },
      p_languages: Array.from(selectedLanguages),
    });
    if (error) {
      setToast(error.message);
      return;
    }
    setSubmissionId(data);
    setPromptIndex(0);
    openCalibration("profile");
  }

  async function uploadAndFinalizeSubmission() {
    const supabase = getSupabase();
    if (!supabase || !authenticatedUserId || !submissionId) {
      localStorage.removeItem("naijavision-contribution-draft");
      setHasDraft(false);
      setStep("complete");
      return;
    }
    setUploadProgress(1);
    try {
      for (const clip of clips) {
        if (!clip.backendRecordingId) await persistAcceptedClip(clip);
      }
    } catch (uploadError) {
      setUploadProgress(0);
      setToast(uploadError instanceof Error ? uploadError.message : "A recording could not be uploaded.");
      return;
    }
    const { error } = await supabase.rpc("finalize_submission", { p_submission_id: submissionId });
    if (error) {
      setToast(error.message);
      return;
    }
    const { error: qcError } = await supabase.functions.invoke("dispatch-quality-control", { body: { submissionId } });
    if (qcError) {
      const { error: manualQueueError } = await supabase.rpc("queue_manual_review", { p_submission_id: submissionId });
      setToast(manualQueueError ? "Submission uploaded. Quality control needs administrator attention." : "Submission uploaded and queued for human review.");
    }
    setUploadProgress(100);
    localStorage.removeItem("naijavision-contribution-draft");
    setHasDraft(false);
    setStep("complete");
  }

  async function makeReviewDecision(decision: "approved" | "rejected" | "changes_requested", comments = "") {
    const target = selectedReviewId || submissionId;
    const supabase = getSupabase();
    if (!supabase || !target) {
      setReviewStatus(decision === "approved" ? "approved" : decision === "changes_requested" ? "changes-requested" : "declined");
      setPaymentStatus(decision === "approved" ? "eligible" : "not-eligible");
      return;
    }
    const { error } = await supabase.rpc("decide_submission", {
      p_submission_id: target,
      p_decision: decision,
      p_comments: comments || null,
    });
    if (error) {
      setToast(error.message);
      return;
    }
    setReviewQueue((queue) => queue.filter((item) => item.id !== target));
    setSelectedReviewId("");
  }

  async function submitReviewRecommendation(recommendation: "approved" | "rejected" | "changes_requested") {
    const supabase = getSupabase();
    if (!supabase || !selectedReviewId) return;
    if (recommendation === "changes_requested" && reviewComments.trim().length < 10) {
      setToast("Add a return comment of at least 10 characters.");
      return;
    }
    const { error } = await supabase.rpc("submit_review_recommendation", {
      p_submission_id: selectedReviewId,
      p_recommendation: recommendation,
      p_comments: reviewComments || null,
    });
    if (error) {
      setToast(error.message);
      return;
    }
    setReviewRecommendation({ recommendation, comments: reviewComments, admin_review_status: "pending", admin_feedback: null });
    setToast("Recommendation sent to an administrator for the final decision.");
  }

  async function returnRecommendationToReviewer() {
    const supabase = getSupabase();
    if (!supabase || !selectedReviewId) return;
    const { error } = await supabase.rpc("return_recommendation_to_reviewer", {
      p_submission_id: selectedReviewId,
      p_feedback: adminDecisionComments,
    });
    if (error) return setToast(error.message);
    setReviewRecommendation((current) => current ? { ...current, admin_review_status: "returned", admin_feedback: adminDecisionComments.trim() } : current);
    setToast("The recommendation was returned to the assigned reviewer.");
  }

  async function returnClipsToParticipant() {
    const supabase = getSupabase();
    if (!supabase || !selectedReviewId) return;
    if (reviewComments.trim().length < 10) {
      setToast("Add a return comment of at least 10 characters for the participant.");
      return;
    }
    const { error } = await supabase.rpc("reviewer_return_clips_to_participant", {
      p_submission_id: selectedReviewId,
      p_comments: reviewComments || null,
    });
    if (error) return setToast(error.message);
    setReviewQueue((queue) => queue.filter((item) => item.id !== selectedReviewId));
    setSelectedReviewId("");
    setToast("The marked recordings were returned to the participant for redo.");
  }

  async function reviewRecording(recordingId: string, decision: "approved" | "rejected" | "changes_requested") {
    const supabase = getSupabase();
    const target = selectedReviewId || submissionId;
    if (!supabase || !target || !authenticatedUserId) {
      setLocalRecordingReviews((reviews) => ({ ...reviews, [recordingId]: decision }));
      setToast(decision === "approved" ? "Recording approved." : decision === "rejected" ? "Recording declined." : "Recording marked for redo.");
      return;
    }
    const { error } = await supabase.from("reviews").upsert({
      submission_id: target,
      recording_id: recordingId,
      reviewer_id: authenticatedUserId,
      decision,
      reason_codes: decision === "rejected" ? ["manual_quality_rejection"] : decision === "changes_requested" ? ["participant_redo_requested"] : [],
      transcript_correct: decision === "approved",
      framing_correct: decision === "approved",
      audio_acceptable: decision === "approved",
      privacy_acceptable: decision === "approved",
    }, { onConflict: "recording_id,reviewer_id" });
    if (error) setToast(error.message);
    else {
      setReviewerRecords((rows) => rows.map((row) => row.id === recordingId ? { ...row, review_decision: decision } : row));
      setToast(decision === "approved" ? "Recording approved." : decision === "rejected" ? "Recording declined." : "Recording marked for redo.");
    }
  }

  async function selectReviewerSubmission(id: string) {
    setReviewComments("");
    setAdminDecisionComments("");
    setReviewRecommendation(null);
    setSelectedReviewId(id);
  }

  async function approvePayment() {
    const target = selectedReviewId || submissionId;
    const supabase = getSupabase();
    if (!supabase || !target) {
      setPaymentStatus("approved");
      return;
    }
    const { error } = await supabase.functions.invoke("process-payment", { body: { submissionId: target } });
    if (error) {
      setToast(error.message);
      return;
    }
    setPaymentStatus("approved");
  }

  async function requestWithdrawal() {
    const supabase = getSupabase();
    if (supabase && submissionId) {
      const { error } = await supabase.rpc("request_withdrawal", {
        p_submission_id: submissionId,
        p_reason: withdrawalReason || null,
      });
      if (error) {
        setToast(error.message);
        return;
      }
    }
    setWithdrawalRequested(true);
  }

  async function enableDevices() {
    setCameraError("");
    setCalibrationMessage("Requesting camera and microphone access...");
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, facingMode: "user" },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false, channelCount: 1, sampleRate: { ideal: 48000 } },
      });
      setStream(media);
      if (media.getAudioTracks().length) {
        const audioContext = new AudioContext();
        await audioContext.resume();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        audioContext.createMediaStreamSource(media).connect(analyser);
        audioContextRef.current = audioContext;
        analyserRef.current = analyser;
      } else {
        analyserRef.current = null;
      }

      setCalibrationMessage("Loading private face-landmark calibration...");
      const vision = await FilesetResolver.forVisionTasks(`${BASE_PATH}/mediapipe-wasm`);
      faceLandmarkerRef.current = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: `${BASE_PATH}/face_landmarker.task`, delegate: "GPU" },
        runningMode: "VIDEO",
        numFaces: 1,
        minFaceDetectionConfidence: 0.7,
        minFacePresenceConfidence: 0.7,
        minTrackingConfidence: 0.7,
      });
      setCalibrationMessage("Devices connected. Press Run calibration and read the test phrase.");
    } catch {
      mediaTracksOff();
      setCameraError("Calibration could not start. Allow both camera and microphone access, then retry.");
      setCalibrationMessage("Both camera and microphone are required.");
    }
  }

  function mediaTracksOff() {
    calibrationRunRef.current += 1;
    if (calibrationFrameRef.current !== null) cancelAnimationFrame(calibrationFrameRef.current);
    calibrationFrameRef.current = null;
    processedAudioNodesRef.current.forEach((node) => node.disconnect());
    processedAudioNodesRef.current = [];
    stream?.getTracks().forEach((track) => track.stop());
    processedStreamRef.current?.getTracks().forEach((track) => track.stop());
    processedStreamRef.current = null;
    recordingCanvasTrackRef.current = null;
    setStream(null);
    setCameraPassed(false);
    setAudioPassed(false);
    setLightingPassed(false);
    setCalibrating(false);
  }

  async function runCalibration() {
    if (!stream || !faceLandmarkerRef.current || !sourceVideoRef.current || !mouthCanvasRef.current) return;
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack || audioTrack.readyState !== "live" || !analyserRef.current || !audioContextRef.current) {
      setAudioPassed(false);
      setCalibrationMessage("The microphone is not active. Reconnect the camera and microphone, allow access, then try again.");
      return;
    }
    if (audioContextRef.current.state === "suspended") await audioContextRef.current.resume();
    calibrationRunRef.current += 1;
    const calibrationRun = calibrationRunRef.current;
    if (calibrationFrameRef.current !== null) cancelAnimationFrame(calibrationFrameRef.current);
    calibrationFrameRef.current = null;
    processedAudioNodesRef.current.forEach((node) => node.disconnect());
    processedAudioNodesRef.current = [];
    setCameraPassed(false);
    setAudioPassed(false);
    setLightingPassed(false);
    faceStableFramesRef.current = 0;
    speechFramesRef.current = 0;
    lightStableFramesRef.current = 0;
    setCalibrating(true);
    setCalibrationMessage('Stay quiet for two seconds, then read aloud: "NaijaVision is ready to record my voice."');
    const startedAt = performance.now();
    let finished = false;
    const audioSamples = new Uint8Array(analyserRef.current?.fftSize || 1024);
    let noiseTotal = 0;
    let noiseFrames = 0;
    let speechTotal = 0;
    let speechFrames = 0;
    let peakLevel = 0;
    let clippedSamples = 0;
    let totalSamples = 0;
    let lastValidCrop: { x: number; y: number; width: number; height: number } | null = null;
    let lastFrameAt = 0;

    const analyze = (frameTime = performance.now()) => {
      if (calibrationRun !== calibrationRunRef.current) return;
      const video = sourceVideoRef.current;
      const canvas = mouthCanvasRef.current;
      const landmarker = faceLandmarkerRef.current;
      const analyser = analyserRef.current;
      if (!video || !canvas || !landmarker || video.readyState < 2) {
        calibrationFrameRef.current = requestAnimationFrame(analyze);
        return;
      }

      // Limit expensive landmark inference during calibration. After calibration,
      // keep the accepted crop stable and draw it at 25 fps without rerunning the model.
      const frameInterval = finished ? 40 : 50;
      if (frameTime - lastFrameAt < frameInterval) {
        calibrationFrameRef.current = requestAnimationFrame(analyze);
        return;
      }
      lastFrameAt = frameTime;

      if (finished && lastValidCrop) {
        const ctx = canvas.getContext("2d", { alpha: false });
        if (ctx) {
          ctx.save();
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.translate(canvas.width, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(video, lastValidCrop.x, lastValidCrop.y, lastValidCrop.width, lastValidCrop.height, 0, 0, canvas.width, canvas.height);
          ctx.restore();
          const previewContext = mouthPreviewRef.current?.getContext("2d", { alpha: false });
          if (previewContext && mouthPreviewRef.current) previewContext.drawImage(canvas, 0, 0, mouthPreviewRef.current.width, mouthPreviewRef.current.height);
        }
        calibrationFrameRef.current = requestAnimationFrame(analyze);
        return;
      }

      const result = landmarker.detectForVideo(video, frameTime);
      const landmarks = result.faceLandmarks[0];
      const ctx = canvas.getContext("2d");
      if (landmarks && ctx) {
        const lipIndices = [61,146,91,181,84,17,314,405,321,375,291,308,324,318,402,317,14,87,178,88,95,78,191,80,81,82,13,312,311,310,415];
        const points = lipIndices.map((index) => landmarks[index]);
        const minX = Math.min(...points.map((point) => point.x));
        const maxX = Math.max(...points.map((point) => point.x));
        const minY = Math.min(...points.map((point) => point.y));
        const maxY = Math.max(...points.map((point) => point.y));
        const lipWidth = (maxX - minX) * video.videoWidth;
        const lipHeight = (maxY - minY) * video.videoHeight;
        const centerX = ((minX + maxX) / 2) * video.videoWidth;
        const centerY = ((minY + maxY) / 2) * video.videoHeight;
        const cropWidth = Math.max(160, lipWidth * 1.75);
        const cropHeight = Math.max(90, lipHeight * 2.15);
        const sourceX = centerX - cropWidth / 2;
        const sourceY = centerY - cropHeight / 2;
        const validCrop = sourceX >= 0 && sourceY >= 0 && sourceX + cropWidth <= video.videoWidth && sourceY + cropHeight <= video.videoHeight;
        const adequateInput = video.videoWidth >= 720 && lipWidth >= 55 && lipHeight >= 18;
        const frontal = Math.abs(landmarks[33].z - landmarks[263].z) < 0.035;
        if (validCrop && adequateInput && frontal) {
          lastValidCrop = { x: sourceX, y: sourceY, width: cropWidth, height: cropHeight };
          ctx.save();
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.translate(canvas.width, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(video, sourceX, sourceY, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
          ctx.restore();
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          let luminance = 0;
          for (let index = 0; index < pixels.length; index += 16) {
            luminance += 0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2];
          }
          const averageLight = luminance / (pixels.length / 16);
          setLightLevel(Math.round(averageLight));
          if (averageLight >= MIN_LIGHT_LEVEL && averageLight <= MAX_LIGHT_LEVEL) lightStableFramesRef.current += 1;
          else lightStableFramesRef.current = Math.max(0, lightStableFramesRef.current - 2);
          const previewContext = mouthPreviewRef.current?.getContext("2d");
          if (previewContext && mouthPreviewRef.current) {
            previewContext.clearRect(0, 0, mouthPreviewRef.current.width, mouthPreviewRef.current.height);
            previewContext.drawImage(canvas, 0, 0, mouthPreviewRef.current.width, mouthPreviewRef.current.height);
          }
          faceStableFramesRef.current += 1;
        } else {
          faceStableFramesRef.current = Math.max(0, faceStableFramesRef.current - 2);
          if (lastValidCrop) {
            ctx.save();
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);
            ctx.drawImage(video, lastValidCrop.x, lastValidCrop.y, lastValidCrop.width, lastValidCrop.height, 0, 0, canvas.width, canvas.height);
            ctx.restore();
          }
        }
      } else {
        faceStableFramesRef.current = 0;
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }

      if (analyser) {
        analyser.getByteTimeDomainData(audioSamples);
        let sum = 0;
        for (const sample of audioSamples) {
          const normalized = (sample - 128) / 128;
          sum += normalized * normalized;
          peakLevel = Math.max(peakLevel, Math.abs(normalized));
          if (Math.abs(normalized) >= 0.98) clippedSamples += 1;
          totalSamples += 1;
        }
        const rms = Math.sqrt(sum / audioSamples.length);
        const elapsed = performance.now() - startedAt;
        if (elapsed < 1800) {
          noiseTotal += rms;
          noiseFrames += 1;
        } else {
          const currentNoiseFloor = noiseFrames ? noiseTotal / noiseFrames : 0;
          const speechThreshold = Math.max(0.0025, currentNoiseFloor * 1.35);
          if (rms > speechThreshold) {
            speechFramesRef.current += 1;
            speechTotal += rms;
            speechFrames += 1;
          }
        }
      }

      if (finished) {
        calibrationFrameRef.current = requestAnimationFrame(analyze);
        return;
      }

      const faceOk = faceStableFramesRef.current >= 25;
      const noiseFloor = noiseFrames ? noiseTotal / noiseFrames : 0;
      const speechLevel = speechFrames ? speechTotal / speechFrames : 0;
      const snr = noiseFloor > 0 ? 20 * Math.log10(Math.max(speechLevel, 0.0001) / noiseFloor) : 0;
      const sampleRate = audioTrack?.getSettings().sampleRate || audioContextRef.current?.sampleRate || 0;
      const clipping = totalSamples ? clippedSamples / totalSamples : 1;
      const audioOk = Boolean(audioTrack && audioTrack.enabled && audioTrack.readyState === "live" && sampleRate >= 8000 && speechFrames > 0);
      const lightOk = lightStableFramesRef.current >= 25;
      setCameraPassed(faceOk);
      setAudioPassed(audioOk);
      setLightingPassed(lightOk);
      setAudioMetrics({ sampleRate, peak: peakLevel, noise: noiseFloor, snr, clipping });

      if (performance.now() - startedAt >= 7000) {
        setCalibrating(false);
        if (faceOk && audioOk && lightOk) {
          const recordingAudioContext = audioContextRef.current;
          if (!recordingAudioContext) {
            setCalibrationMessage("The audio processor stopped unexpectedly. Reconnect the microphone and run calibration again.");
            return;
          }
          finished = true;
          setCalibrationMessage("Camera, microphone, and lighting calibration passed. The recording stream contains only the mouth crop and synchronized audio.");
          const canvasStream = canvas.captureStream(25);
          const canvasTrack = canvasStream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
          canvasTrack.contentHint = "motion";
          recordingCanvasTrackRef.current = canvasTrack;
          const audioDestination = recordingAudioContext.createMediaStreamDestination();
          const microphoneSource = recordingAudioContext.createMediaStreamSource(new MediaStream([audioTrack]));
          const highPass = recordingAudioContext.createBiquadFilter();
          highPass.type = "highpass";
          highPass.frequency.value = 120;
          highPass.Q.value = 0.7;
          const hum50 = recordingAudioContext.createBiquadFilter();
          hum50.type = "notch";
          hum50.frequency.value = 50;
          hum50.Q.value = 12;
          const hum100 = recordingAudioContext.createBiquadFilter();
          hum100.type = "notch";
          hum100.frequency.value = 100;
          hum100.Q.value = 12;
          const hum150 = recordingAudioContext.createBiquadFilter();
          hum150.type = "notch";
          hum150.frequency.value = 150;
          hum150.Q.value = 12;
          microphoneSource.connect(highPass).connect(hum50).connect(hum100).connect(hum150).connect(audioDestination);
          processedAudioNodesRef.current = [microphoneSource, highPass, hum50, hum100, hum150, audioDestination];
          audioDestination.stream.getAudioTracks().forEach((track) => { track.contentHint = "speech"; });
          const combined = new MediaStream([
            canvasTrack,
            ...audioDestination.stream.getAudioTracks(),
          ]);
          processedStreamRef.current?.getTracks().forEach((track) => track.stop());
          processedStreamRef.current = combined;
          calibrationFrameRef.current = requestAnimationFrame(analyze);
        } else if (!audioOk) {
          setCalibrationMessage("No audible speech detected. Check that a microphone is connected and read the test phrase aloud.");
        } else if (!lightOk) {
          setCalibrationMessage("Lighting test failed. Add soft front lighting or move away from harsh direct light.");
        } else if (!faceOk) {
          setCalibrationMessage("Camera test failed: use at least 720p, face forward, move closer, and keep your mouth unobstructed.");
        }
        return;
      }
      calibrationFrameRef.current = requestAnimationFrame(analyze);
    };
    analyze();
  }

  function beginRecording() {
    const recordingStream = processedStreamRef.current;
    if (!recordingStream || !cameraPassed || !audioPassed || !lightingPassed) return;
    const preferred = [
      "video/webm;codecs=vp8,opus",
      "video/webm;codecs=vp9,opus",
      "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
      "video/mp4;codecs=avc1,mp4a.40.2",
      "video/mp4",
      "video/webm",
    ].find((type) => MediaRecorder.isTypeSupported(type));
    if (!preferred) {
      setToast("This browser cannot create a supported video file. Update the browser or try Chrome, Edge, or Safari.");
      return;
    }
    const recorder = new MediaRecorder(recordingStream, { mimeType: preferred, videoBitsPerSecond: 900_000, audioBitsPerSecond: 96_000 });
    chunksRef.current = [];
    recorder.ondataavailable = (event) => event.data.size && chunksRef.current.push(event.data);
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || preferred });
      const duration = (Date.now() - startedRef.current) / 1000;
      setPreview({ blob, duration, url: URL.createObjectURL(blob) });
    };
    recorder.start(2000);
    recorderRef.current = recorder;
    startedRef.current = Date.now();
    setElapsed(0);
    setRecording(true);
    timerRef.current = setInterval(() => setElapsed((v) => v + 0.25), 250);
  }

  function stopRecording() {
    recorderRef.current?.stop();
    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
  }

  async function acceptRecording() {
    if (!preview || savingRecording) return;
    setSavingRecording(true);
    const videoSettings = processedStreamRef.current?.getVideoTracks()[0]?.getSettings();
    const audioSettings = processedStreamRef.current?.getAudioTracks()[0]?.getSettings();
    const clip: Clip = {
      id: `NV-${Date.now()}`,
      promptId: current.id,
      transcript: current.text,
      language: current.language,
      duration: preview.duration,
      createdAt: new Date().toISOString(),
      status: preview.duration >= 2 && preview.duration <= (current.responseSeconds || 20) ? "accepted" : "needs-review",
      metadata: {
        sessionId: profile.code,
        timestamp: new Date().toISOString(),
        promptType: current.type,
        language: current.language,
        dialect: profile.dialect || null,
        normalizedTranscript: current.text.toLocaleLowerCase(),
        englishTranslation: current.translation || null,
        codeSwitchLanguageSequence: current.type === "Code-switching" ? current.language : null,
        width: videoSettings?.width ?? null,
        height: videoSettings?.height ?? null,
        frameRate: videoSettings?.frameRate ?? null,
        audioSampleRate: audioSettings?.sampleRate ?? null,
        fileSize: preview.blob.size,
        deviceOrientation: screen.orientation?.type ?? null,
        browser: navigator.userAgent,
        operatingSystem: profile.operatingSystem || null,
        networkType: profile.internet,
        deviceCategory: profile.deviceType,
        deviceModel: profile.deviceModel || null,
        lightingCondition: profile.lighting,
        measuredLightLevel: lightLevel,
        recordingEnvironment: profile.recordingLocation,
        estimatedNoiseLevel: audioMetrics.noise,
        measuredSnrDb: audioMetrics.snr,
        clippingRate: audioMetrics.clipping,
        cameraAngle: "frontal calibration passed",
        speakingStyle: current.type === "Natural speech" ? "spontaneous" : "prompted",
        humanValidationStatus: "pending",
      },
      blob: preview.blob,
    };
    let savedClip = clip;
    try {
      savedClip = await persistAcceptedClip(clip);
      if (savedClip.backendRecordingId) {
        await compactStoredCloudClips().catch(() => undefined);
        await saveClip({ ...savedClip, blob: new Blob([]) }).catch(() => undefined);
      } else {
        await saveClip(savedClip);
      }
      if (backendConfigured && submissionId) {
        const { data: earnings } = await getSupabase()!.from("submissions").select("compensation_amount,compensation_currency,completed_language_count,completed_standard_language_count,completed_safe_speech_language_count").eq("id", submissionId).maybeSingle();
        if (earnings) setEarnedCompensation({ amount: Number(earnings.compensation_amount || 0), currency: earnings.compensation_currency || "NGN", completedLanguages: Number(earnings.completed_language_count || 0), standardLanguages: Number(earnings.completed_standard_language_count || 0), safeSpeechLanguages: Number(earnings.completed_safe_speech_language_count || 0) });
      }
    } catch (error) {
      setSavingRecording(false);
      setUploadProgress(0);
      setToast(`Recording was not saved: ${readableError(error)}`);
      setTimeout(() => setToast(""), 4000);
      return;
    }
    setClips((items) => [...items.filter((item) => item.promptId !== savedClip.promptId), savedClip]);
    URL.revokeObjectURL(preview.url);
    setPreview(null);
    setSavingRecording(false);
    setToast("Recording accepted");
    setTimeout(() => setToast(""), 2200);
    if (promptIndex === prompts.length - 1) setStep("review");
    else setPromptIndex((i) => i + 1);
  }

  function redo() {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
  }

  function downloadRecording(blob: Blob, promptId: string) {
    const extension = blob.type.includes("mp4") ? "mp4" : "webm";
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${profile.code}-${promptId}.${extension}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function downloadSavedRecording(clip: Clip) {
    try {
      downloadRecording(await getRecordingBlob(clip), clip.promptId);
    } catch (error) {
      setToast(`Recording could not be downloaded: ${readableError(error)}`);
    }
  }

  async function playSavedRecording(clip: Clip) {
    try {
      const blob = await getRecordingBlob(clip);
      if (reviewMedia) URL.revokeObjectURL(reviewMedia);
      setReviewMedia(URL.createObjectURL(blob));
    } catch (error) {
      setToast(`Recording could not be played: ${readableError(error)}`);
    }
  }

  function selectPrompt(index: number) {
    if (recording || savingRecording) {
      setToast("Stop or finish saving the current recording before changing prompts.");
      setTimeout(() => setToast(""), 2500);
      return;
    }
    if (preview && !window.confirm("Discard the recording preview and open another prompt?")) return;
    if (preview) redo();
    setPromptIndex(index);
  }

  const routeOrder: Step[] = ["account", "study", "consent", "profile", "calibrate", "record", "review", "complete"];
  const activeIndex = routeOrder.indexOf(step);
  const navLabel = step === "reviewer" ? currentRole === "admin" && adminWorkspaceView === "operations" ? "Administrator workspace" : "Review workspace" : step === "welcome" ? "Open research contribution" : "Participant session";
  const selectedReviewSubmission = reviewQueue.find((item) => item.id === selectedReviewId);
  const everyRecordingReviewed = reviewerRecords.length > 0 && reviewerRecords.every((record) => Boolean(record.review_decision));
  const everyRecordingApproved = reviewerRecords.length > 0 && reviewerRecords.every((record) => record.review_decision === "approved");
  const hasRecordingForRedo = reviewerRecords.some((record) => record.review_decision === "rejected" || record.review_decision === "changes_requested");
  const reviewerVideoCount = reviewerPayments.reduce((total, payment) => total + payment.reviewed_video_count, 0);
  const reviewerTotalEarned = reviewerPayments.reduce((total, payment) => total + payment.amount, 0);
  const reviewerPaid = reviewerPayments.filter((payment) => payment.status === "paid").reduce((total, payment) => total + payment.amount, 0);
  const reviewerPending = reviewerPayments.filter((payment) => payment.status !== "paid" && payment.status !== "cancelled").reduce((total, payment) => total + payment.amount, 0);

  return (
    <main>
      <div className="processing-sources" aria-hidden="true">
        <video ref={sourceVideoRef} muted playsInline />
        <canvas ref={mouthCanvasRef} width="256" height="128" />
      </div>
      <header className="topbar">
        <button className="brand" onClick={() => setStep("welcome")} aria-label="NaijaVision home">
          <span className="brand-icon"><i /><i /><i /></span>
          <span>Naija<span>Vision</span></span>
        </button>
        <div className="top-context"><span className="privacy-dot" /> {navLabel}</div>
        {currentRole === "reviewer" || currentRole === "admin" ? (
          <nav className="workspace-nav" aria-label="Account navigation">
            <Link className="admin-link" href="/dashboard">Dashboard</Link>
            {currentRole === "reviewer" ? <button className="admin-link" onClick={() => setStep(step === "reviewer" ? "welcome" : "reviewer")}>{step === "reviewer" ? "Participant site" : "Reviewer workspace"}</button> : <><button className="admin-link" onClick={() => { setAdminWorkspaceView("reviews"); setStep("reviewer"); }}>Review workspace</button><button className="admin-link" onClick={() => { setAdminWorkspaceView("operations"); setStep("reviewer"); }}>Admin workspace</button></>}
            {backendConfigured && <button className="admin-link" onClick={handleStaffSignOut}>Sign out</button>}
          </nav>
        ) : authenticatedUserId ? (
          <div className="nav-auth-links">
            <Link className="admin-link" href="/dashboard">Dashboard</Link>
            <button className="admin-link" onClick={handleStaffSignOut}>Sign out</button>
          </div>
        ) : (
          <div className="nav-auth-links">
            <Link className="admin-link" href="/signin">Sign in</Link>
            <Link className="admin-link" href="/signup">Sign up</Link>
          </div>
        )}
      </header>

      {step !== "welcome" && step !== "reviewer" && (
        <div className="stepbar">
          {["Account", "Study", "Consent", "Survey", "Checks", "Record", "Review", "Submit"].map((label, index) => (
            <div className={`stepitem ${index <= activeIndex ? "active" : ""}`} key={label}>
              <span>{index < activeIndex ? "✓" : index + 1}</span><b>{label}</b>
            </div>
          ))}
        </div>
      )}

      {step === "welcome" && (
        <>
          <section className="hero">
            <div className="hero-copy">
              <div className="eyebrow">NaijaVSR · Open research platform</div>
              <h1>Help machines <em>see</em><br />the way Nigeria speaks.</h1>
              <p>Contribute short audio-visual recordings in Nigerian languages from anywhere in the world. Create a minimal verified account so approved contributions can be compensated.</p>
              <div className="hero-actions">
                <Link className="primary" href={authenticatedUserId ? "/?contribute=1" : "/signin?next=/dashboard"}>Begin contribution <span>→</span></Link>
                {hasDraft && (authenticatedUserId ? <button className="secondary" onClick={resumeDraft}>Resume contribution</button> : <Link className="secondary" href="/signin?next=/dashboard">Sign in to resume</Link>)}
              </div>
              <div className="trust-row">
                <div><Mark>◒</Mark><span><b>Privacy-conscious</b><small>Clear consent and permissions</small></span></div>
                <div><Mark>◎</Mark><span><b>Open worldwide</b><small>Verified participation and payment</small></span></div>
                <div><Mark>↗</Mark><span><b>You are in control</b><small>Replay, redo, or skip</small></span></div>
              </div>
            </div>
            <div className="hero-visual">
              <div className="visual-card">
                <div className="camera-frame">
                  <div className="face-silhouette"><div className="mouth-window"><span /></div></div>
                  <span className="corner tl" /><span className="corner tr" /><span className="corner bl" /><span className="corner br" />
                </div>
                <div className="wave">{Array.from({ length: 30 }).map((_, i) => <i key={i} style={{ height: `${10 + ((i * 13) % 34)}px` }} />)}</div>
                <div className="visual-meta"><span><i /> PRIVATE PREVIEW</span><b>Audio + mouth video</b></div>
              </div>
              <div className="language-orbit">{["IG", "YO", "HA", "PCM", "EN"].map((l) => <span key={l}>{l}</span>)}</div>
            </div>
          </section>

          <section className="tips-section">
            <div className="section-head"><div><div className="eyebrow">Before you begin</div><h2>Get a good recording on the first try.</h2></div></div>
            <div className="tips-grid">
              <div className="tips-card do">
                <h3><span>✓</span> The Dos</h3>
                <ul>
                  <li>Sit in a well-lit room facing a window or light source.</li>
                  <li>Keep your face clearly visible within the frame.</li>
                  <li>Speak naturally, clearly, and at a normal pace.</li>
                  <li>Ensure a quiet environment with minimal background noise.</li>
                </ul>
              </div>
              <div className="tips-card dont">
                <h3><span>✕</span> The Don&apos;ts</h3>
                <ul>
                  <li>Do not sit with a bright window directly behind you.</li>
                  <li>Do not cover your mouth with your hands or props.</li>
                  <li>Do not whisper or shout the prompts.</li>
                  <li>Do not have music or television playing in the background.</li>
                </ul>
              </div>
            </div>
          </section>
        </>
      )}

      {step === "account" && (
        <section className="shell narrow">
          <div className="section-head"><div><div className="eyebrow">{paymentEditMode ? "Payment settings" : "Participant account"}</div><h2>{paymentEditMode ? "Update payment details." : "Create your contribution record."}</h2><p>{paymentEditMode ? "Verify a replacement Nigerian bank account for future approved compensation." : "Use a contact method you can verify and bank details that can receive your compensation after approval."}</p></div></div>
          {paymentEditMode && savedAccountLast4 && <div className="notice"><Mark>i</Mark><p>Your current verified payment account ends in <b>{savedAccountLast4}</b>. Enter the full 10-digit number below only when replacing it.</p></div>}
          <div className="form-grid">
            <label><span>Contact method</span><select value={account.contactMethod} onChange={(e) => setAccount({ ...account, contactMethod: e.target.value })}><option>Email</option><option>Phone number</option></select></label>
            <label><span>{account.contactMethod}</span><input value={account.contact} onChange={(e) => setAccount({ ...account, contact: e.target.value })} placeholder={account.contactMethod === "Email" ? "name@example.com" : "+234..."} /></label>
            <label><span>Bank country</span><select value={account.payoutCountry} onChange={(e) => setAccount({ ...account, payoutCountry: e.target.value })}>{countries.map((country) => <option key={country}>{country}</option>)}</select></label>
            <label><span>Bank name</span><select value={account.bankCode} onChange={(e) => { const bank = nigerianBanks.find((item) => item.code === e.target.value); setAccount({ ...account, bankCode: e.target.value, bankName: bank?.name || "", accountName: "" }); setBankVerified(false); }}><option value="">Select your bank</option>{nigerianBanks.map((bank) => <option key={bank.code} value={bank.code}>{bank.name}</option>)}</select></label>
            <label><span>Account name</span><input value={account.accountName} readOnly placeholder="Shown after verification" /></label>
            <label className="wide"><span>10-digit account number</span><div className="inline-verify"><input inputMode="numeric" maxLength={10} value={account.accountNumber} onChange={(e) => { setAccount({ ...account, accountNumber: e.target.value.replace(/\D/g, "").slice(0, 10), accountName: "" }); setBankVerified(false); }} placeholder="Enter 10 digits" /><button className="secondary" type="button" disabled={verifyingBank || !account.bankCode || account.accountNumber.length !== 10} onClick={verifyPayoutAccount}>{verifyingBank ? "Verifying..." : "Verify account"}</button></div></label>
            {authRequested && !authVerified && <label className="wide"><span>Verification code</span><div className="inline-verify"><input inputMode="numeric" value={authCode} onChange={(e) => setAuthCode(e.target.value)} placeholder="Enter the code you received" /><button className="secondary" type="button" onClick={verifyAccountCode}>Verify</button></div></label>}
          </div>
          <div className="notice"><Mark>i</Mark><p>Compensation becomes payable after a reviewer approves the completed submission. Make sure the account details are correct.</p></div>
          {authMessage && <p className="auth-message">{authMessage}</p>}
          <div className="footer-actions"><button className="secondary" onClick={() => paymentEditMode ? window.location.assign(`${BASE_PATH}/dashboard`) : setStep("welcome")}>{paymentEditMode ? "Cancel" : "Back"}</button>{authVerified ? <button className="primary" disabled={!bankVerified} onClick={savePayoutAndContinue}>{paymentEditMode ? "Save verified payment details" : "Continue with verified account"} <span>→</span></button> : <button className="primary" disabled={!account.contact.trim()} onClick={requestAccountVerification}>Verify contact <span>→</span></button>}</div>
        </section>
      )}

      {step === "study" && (
        <section className="shell narrow">
          <div className="section-head"><div><div className="eyebrow">Study information</div><h2>Read this before consenting.</h2><p>Please read each section. You will provide electronic consent on the next screen.</p></div></div>
          <article className="study-document">
            <h3>What this study is for</h3><p>NaijaVision collects synchronized speech and mouth-region video for Nigerian English, Nigerian Pidgin, Hausa, Igbo, Yorùbá, multilingual code-switching, accessibility research, and related language technologies.</p>
            <h3>What you will do</h3><p>Complete a language survey, pass microphone, camera, and lighting checks, read prompted sentences, answer four questions naturally, optionally perform NaijaSafeSpeech prompts, review your recordings, and submit them for human validation.</p>
            <h3>What is NaijaSafeSpeech?</h3><p>NaijaSafeSpeech is a separate, clearly marked, and entirely optional set of prompts. You read scripted example sentences containing discriminatory or hateful language, written by the research team for this study. They are not your own words or opinions. These recordings are used only to help train AI systems to recognize and moderate hate speech in Nigerian languages. They are tagged separately from the rest of the dataset, and you are never required to participate in this part to take part in NaijaVSR.</p>
            <h3>What we collect</h3><p>Audio, mouth-region video, transcripts, language and demographic responses, device and environment metadata, calibration results, recording quality information, consent status, and a non-identifying participant ID.</p>
            <h3>Privacy limitation</h3><blockquote>The collection method reduces identity exposure by excluding most of the face, while acknowledging that audio and mouth-region video remain potentially identifiable biometric data.</blockquote>
            <h3>Public release and research use</h3><p>Accepted research recordings and approved participant metadata are intended for public dataset release and AI research.</p>
            <h3>Review and compensation</h3><p>Submission does not guarantee approval. A trained reviewer checks prompt accuracy, audio and video quality, privacy, duplication, and policy compliance. The rate is 500 NGN for each language whose required recordings are completed, payable only after approval.</p>
            <div className="compensation-callout">
              <div><small>Rate per completed language</small><b>{compensationRate.amount} {compensationRate.currency}</b></div>
              <div><small>Potential total for selected language sets</small><b>{potentialCompensation.amount} {potentialCompensation.currency}</b></div>
            </div>
            <h3>Your choice and rights</h3><p>Participation is voluntary. You may skip optional questions, redo recordings, stop before submission, and request access, correction, or withdrawal where applicable. NaijaVSR participation does not require NaijaSafeSpeech participation.</p>
          </article>
          <div className="footer-actions"><button className="secondary" onClick={() => setStep("account")}>Back</button><button className="primary" onClick={() => setStep("consent")}>I have read the study information <span>→</span></button></div>
        </section>
      )}

      {step === "consent" && (
        <section className="shell narrow">
          <div className="section-head"><div><div className="eyebrow">Electronic consent</div><h2>Confirm your agreement.</h2><p>You have read the study information. Three confirmations are required to participate.</p></div></div>
          <div className="notice"><Mark>i</Mark><p><b>Privacy limitation.</b> The collection method reduces identity exposure by excluding most of the face, while acknowledging that audio and mouth-region video remain potentially identifiable biometric data.</p></div>
          <div className="consent-list">
            {[
              ["adult", "I confirm that I am 18 or older", "This release is limited to adult contributors."],
              ["informed", "I have read and understood the study information", "I understand the tasks, risks, privacy limitations, review process, and my rights."],
              ["publicUse", "I consent to recording and public research use", "Accepted audio, mouth video, transcripts, and pseudonymized metadata may be published and used to train and evaluate AI models."],
            ].map(([key, title, detail]) => (
              <label className="check-card" key={key}>
                <input type="checkbox" checked={consent[key as keyof typeof consent]} onChange={(e) => setConsent({ ...consent, [key]: e.target.checked })} />
                <span className="checkbox">✓</span><span><b>{title}</b><small>{detail}</small></span>
              </label>
            ))}
          </div>
          <label className="optional-card">
            <div><b>Optional: NaijaSafeSpeech</b><small>A separately identified set of performed hate-speech prompts. These are scripted examples, not your own words, and are used to train hate-speech detection. You may contribute to NaijaVSR without selecting this option.</small></div>
            <input type="checkbox" checked={harmful} onChange={(e) => setHarmful(e.target.checked)} /><span className="switch" />
          </label>
          <div className="footer-actions"><button className="secondary" onClick={() => setStep("study")}>Back</button><button className="primary" disabled={!consentReady} onClick={() => setStep("profile")}>Provide consent and continue <span>→</span></button></div>
        </section>
      )}

      {step === "profile" && (
        <section className="shell survey-shell">
          <div className="section-head"><div><div className="eyebrow">Participant survey</div><h2>Tell us about your language and recording context.</h2><p>Fields marked optional may be skipped. Participant ID and participation date are generated automatically.</p></div></div>
          <div className="auto-fields"><div><small>Participant ID</small><b>{profile.code}</b></div><div><small>Participation date</small><b>{new Date(profile.participationDate).toLocaleDateString()}</b></div></div>

          <div className="survey-section"><h3><span>A</span> Location and residence</h3><div className="form-grid">
            <label><span>Country of residence</span><select value={profile.country} onChange={(e) => setProfile({ ...profile, country: e.target.value, state: "", lga: "" })}>{countries.map((item) => <option key={item}>{item}</option>)}</select></label>
            {profile.country === "Other" && <label><span>Specify country</span><input value={profile.otherCountry} onChange={(e) => setProfile({ ...profile, otherCountry: e.target.value })} /></label>}
            <label><span>State or province</span>{profile.country === "Nigeria" ? <select value={profile.state} onChange={(e) => setProfile({ ...profile, state: e.target.value, lga: "" })}><option value="">Select state</option>{Object.keys(lgas).sort().map((item) => <option key={item}>{item}</option>)}</select> : <input value={profile.state} onChange={(e) => setProfile({ ...profile, state: e.target.value })} />}</label>
            {profile.country === "Nigeria" && <label><span>Local Government Area</span><select value={profile.lga} disabled={!profile.state} onChange={(e) => setProfile({ ...profile, lga: e.target.value })}><option value="">{profile.state ? "Select LGA" : "Select state first"}</option>{(lgas[profile.state] || []).map((item) => <option key={item}>{item}</option>)}</select></label>}
            <label><span>Urban or rural residence</span><select value={profile.residence} onChange={(e) => setProfile({ ...profile, residence: e.target.value })}><option>Urban</option><option>Semi-Urban</option><option>Rural</option></select></label>
          </div></div>

          <div className="survey-section"><h3><span>B</span> Demographic information</h3><div className="form-grid">
            <label><span>Age group</span><select value={profile.age} onChange={(e) => setProfile({ ...profile, age: e.target.value })}>{["18–24","25–34","35–44","45–54","55–64","65+"].map((item) => <option key={item}>{item}</option>)}</select></label>
            <label><span>Gender <small>optional</small></span><select value={profile.gender} onChange={(e) => setProfile({ ...profile, gender: e.target.value })}>{["Male","Female","Non-binary","Prefer not to say","Self-describe"].map((item) => <option key={item}>{item}</option>)}</select></label>
            {profile.gender === "Self-describe" && <label><span>Self-description</span><input value={profile.genderOther} onChange={(e) => setProfile({ ...profile, genderOther: e.target.value })} /></label>}
            <label><span>Highest educational qualification</span><select value={profile.education} onChange={(e) => setProfile({ ...profile, education: e.target.value })}><option value="">Select qualification</option>{educationOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label><span>Occupation <small>optional</small></span><input value={profile.occupation} onChange={(e) => setProfile({ ...profile, occupation: e.target.value })} /></label>
          </div></div>

          <div className="survey-section"><h3><span>C</span> Language background and code-switching</h3><div className="form-grid">
            <label className="wide"><span>Native languages <small>select multiple</small></span><MultiSelect options={languages} value={profile.nativeLanguages} onChange={(value) => setProfile({ ...profile, nativeLanguages: value })} /></label>
            <label className="wide"><span>Other languages spoken <small>select multiple</small></span><MultiSelect options={languages} value={profile.otherLanguages} onChange={(value) => setProfile({ ...profile, otherLanguages: value })} /></label>
            <label><span>Primary language</span><select value={profile.primary} onChange={(e) => setProfile({ ...profile, primary: e.target.value })}>{languages.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label><span>Dialect or accent <small>optional</small></span><input value={profile.dialect} onChange={(e) => setProfile({ ...profile, dialect: e.target.value })} placeholder="e.g. Owerri Igbo" /></label>
            <label><span>Primary language used at home</span><select value={profile.homeLanguage} onChange={(e) => setProfile({ ...profile, homeLanguage: e.target.value })}><option value="">Select language</option>{languages.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label><span>Primary language used at work or school</span><select value={profile.workLanguage} onChange={(e) => setProfile({ ...profile, workLanguage: e.target.value })}><option value="">Select language</option>{languages.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="wide"><span>Languages used daily</span><MultiSelect options={languages} value={profile.dailyLanguages} onChange={(value) => setProfile({ ...profile, dailyLanguages: value })} /></label>
            <label><span>Can you read your primary language?</span><select value={profile.canRead} onChange={(e) => setProfile({ ...profile, canRead: e.target.value })}><option>Yes</option><option>No</option><option>Partially</option></select></label>
            <label><span>Can you write your primary language?</span><select value={profile.canWrite} onChange={(e) => setProfile({ ...profile, canWrite: e.target.value })}><option>Yes</option><option>No</option><option>Partially</option></select></label>
            <label><span>How often do you switch languages?</span><select value={profile.switchingFrequency} onChange={(e) => setProfile({ ...profile, switchingFrequency: e.target.value })}>{["Never","Rarely","Sometimes","Frequently","Always"].map((item) => <option key={item}>{item}</option>)}</select></label>
            <label><span>Languages commonly mixed <small>optional</small></span><input value={profile.mixedLanguages} onChange={(e) => setProfile({ ...profile, mixedLanguages: e.target.value })} placeholder="e.g. Igbo, English, Pidgin" /></label>
          </div></div>

          <div className="survey-section"><h3><span>D</span> Speech, hearing, and accessibility</h3><div className="form-grid">
            <label><span>Speech impairment</span><select value={profile.speechImpairment} onChange={(e) => setProfile({ ...profile, speechImpairment: e.target.value })}><option>No</option><option>Yes</option></select></label>
            {profile.speechImpairment === "Yes" && <label><span>Optional description</span><input value={profile.speechDescription} onChange={(e) => setProfile({ ...profile, speechDescription: e.target.value })} /></label>}
            <label><span>Hearing impairment</span><select value={profile.hearingImpairment} onChange={(e) => setProfile({ ...profile, hearingImpairment: e.target.value })}><option>No</option><option>Yes</option></select></label>
            <label><span>Normally wear glasses?</span><select value={profile.glasses} onChange={(e) => setProfile({ ...profile, glasses: e.target.value })}><option>Yes</option><option>No</option></select></label>
            <label><span>Face covering while speaking</span><select value={profile.faceCovering} onChange={(e) => setProfile({ ...profile, faceCovering: e.target.value })}><option>Frequently</option><option>Occasionally</option><option>Never</option></select></label>
            <label className="wide"><span>Accessibility tools <small>select multiple</small></span><MultiSelect options={accessibilityOptions} value={profile.accessibility} onChange={(value) => setProfile({ ...profile, accessibility: value })} /></label>
          </div></div>

          <div className="survey-section"><h3><span>E</span> Device and recording environment</h3><div className="form-grid">
            <label><span>Device type</span><select value={profile.deviceType} onChange={(e) => setProfile({ ...profile, deviceType: e.target.value })}>{deviceTypes.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label><span>Operating system</span><select value={profile.operatingSystem} onChange={(e) => setProfile({ ...profile, operatingSystem: e.target.value })}><option value="">Select OS</option>{operatingSystems.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label><span>Device brand</span><input value={profile.deviceBrand} onChange={(e) => setProfile({ ...profile, deviceBrand: e.target.value })} placeholder="Samsung, Apple, Tecno, Infinix" /></label>
            <label><span>Device model <small>optional</small></span><input value={profile.deviceModel} onChange={(e) => setProfile({ ...profile, deviceModel: e.target.value })} /></label>
            <label><span>Camera resolution <small>if known</small></span><input value={profile.cameraResolution} onChange={(e) => setProfile({ ...profile, cameraResolution: e.target.value })} placeholder="e.g. 1080p" /></label>
            <label><span>Microphone type</span><select value={profile.microphoneType} onChange={(e) => setProfile({ ...profile, microphoneType: e.target.value })}>{["Built-in","Wired headset","Bluetooth headset","USB microphone","External microphone","Unknown"].map((item) => <option key={item}>{item}</option>)}</select></label>
            <label><span>How long have you used this device?</span><select value={profile.deviceAge} onChange={(e) => setProfile({ ...profile, deviceAge: e.target.value })}>{["Less than 6 months","6–12 months","1–2 years","More than 2 years"].map((item) => <option key={item}>{item}</option>)}</select></label>
            <label><span>Device ownership</span><select value={profile.deviceOwnership} onChange={(e) => setProfile({ ...profile, deviceOwnership: e.target.value })}><option>Personal</option><option>Shared</option><option>Borrowed</option></select></label>
            <label><span>Device use frequency</span><select value={profile.deviceFrequency} onChange={(e) => setProfile({ ...profile, deviceFrequency: e.target.value })}><option>Daily</option><option>Weekly</option><option>Occasionally</option></select></label>
            <label><span>Recording location</span><select value={profile.recordingLocation} onChange={(e) => setProfile({ ...profile, recordingLocation: e.target.value })}>{["Home","Office","Classroom","Outdoor","Vehicle","Studio","Other"].map((item) => <option key={item}>{item}</option>)}</select></label>
            <label><span>Background noise level</span><select value={profile.noiseLevel} onChange={(e) => setProfile({ ...profile, noiseLevel: e.target.value })}>{["Very quiet","Quiet","Moderate","Loud","Very loud"].map((item) => <option key={item}>{item}</option>)}</select></label>
            <label><span>Lighting condition</span><select value={profile.lighting} onChange={(e) => setProfile({ ...profile, lighting: e.target.value })}>{["Bright daylight","Indoor lighting","Low light","Mixed lighting"].map((item) => <option key={item}>{item}</option>)}</select></label>
            <label><span>Internet during recording</span><select value={profile.internet} onChange={(e) => setProfile({ ...profile, internet: e.target.value })}><option>Wi-Fi</option><option>Mobile Data</option><option>Offline</option></select></label>
          </div></div>
          <div className="footer-actions"><button className="secondary" onClick={() => setStep("consent")}>Back</button><button className="primary" onClick={prepareBackendSubmission}>Continue to setup <span>→</span></button></div>
        </section>
      )}

      {step === "calibrate" && (
        <section className="shell">
          <div className="section-head"><div><div className="eyebrow">Camera & microphone</div><h2>Let’s get a clear recording.</h2><p>Your camera feed is processed in this browser. Only recordings you accept are kept.</p></div></div>
          <div className="calibration-layout">
            <div className="live-card">
              <div className="video-stage">
                {stream ? <canvas ref={mouthPreviewRef} width="512" height="256" className="mouth-only-preview" /> : <div className="camera-placeholder"><Mark>◉</Mark><b>Camera preview is off</b><small>Both camera and microphone access are required.</small></div>}
                {stream && !cameraPassed && <div className="crop-placeholder"><b>Mouth-only preview</b><small>Your eyes, nose, and full face are not shown or recorded.</small></div>}
              </div>
              {!stream && <button className="primary full" onClick={enableDevices}>Enable camera & microphone</button>}
              {stream && <button className="primary full" disabled={calibrating || !faceLandmarkerRef.current} onClick={runCalibration}>{calibrating ? "Testing for 7 seconds..." : cameraPassed && audioPassed && lightingPassed ? "Run calibration again" : "Run all required checks"}</button>}
              <p className={`calibration-message ${cameraPassed && audioPassed && lightingPassed ? "passed" : ""}`}>{calibrationMessage}</p>
              {cameraError && <p className="error">{cameraError}</p>}
            </div>
            <div className="check-panel">
              <h3>Required calibration</h3>
              {[
                ["Camera access", stream?.getVideoTracks().length ? "Connected" : "Waiting", !!stream?.getVideoTracks().length],
                ["Microphone access", stream?.getAudioTracks().length ? "Connected" : "Waiting", !!stream?.getAudioTracks().length],
                ["Mouth crop", cameraPassed ? "Face forward, 720p input, lips tracked" : "Not yet passed", cameraPassed],
                ["Microphone check", audioPassed ? "Live microphone track is ready" : "Allow microphone access and check that a microphone is connected", audioPassed],
                ["Lighting", lightingPassed ? `Lighting is ready at ${lightLevel}` : lightLevel < MIN_LIGHT_LEVEL ? `Brightness ${lightLevel}. Add a little light in front of you.` : `Brightness ${lightLevel}. Reduce harsh direct light.`, lightingPassed],
               ].map(([label, value, ok]) => <div className="device-check" key={String(label)}><span className={ok ? "ok" : ""}>{ok ? "✓" : "·"}</span><div><b>{label}</b><small>{value}</small></div></div>)}
               <div className="tip"><b>All checks are required</b><p>Recording remains locked until a live microphone track and the mouth, camera, and lighting checks pass. Volume, background noise, clipping, and speech activity are saved as reviewer warnings, but they do not block this test.</p></div>
               <div className="calibration-cta"><button className="secondary" onClick={() => setStep(calibrationReturnStep)}>Back</button><button className="primary" disabled={!cameraPassed || !audioPassed || !lightingPassed || !processedStreamRef.current} onClick={() => setStep("record")}>{cameraPassed && audioPassed && lightingPassed ? "Begin recording" : "Complete checks to continue"} <span>→</span></button></div>
             </div>
          </div>
          <div className="requirements">
            <div><h3>Environment</h3><p>Choose a quiet location with usable front lighting. The accepted brightness range is {MIN_LIGHT_LEVEL} to {MAX_LIGHT_LEVEL}. Keep the camera steady at eye level, avoid strong backlighting, and minimize movement behind you.</p></div>
            <div><h3>Audio and delivery</h3><p>Speak naturally without whispering or rushing. Pause briefly between prompts and do not use voice-changing software.</p></div>
            <div><h3>Position and equipment</h3><p>Look toward the camera, keep your face centered, and remain about 50 to 100 cm away. Recommended minimum: 720p video, 30 fps, and 8 kHz audio.</p></div>
          </div>
          <div className="quality-confirm">
            <h3>Participant recording checklist</h3><p>Confirm the environment and speaking conditions. Face visibility and audio activity are tested automatically above.</p>
            <MultiSelect options={["Good lighting", "Minimal background noise", "Camera stable", "Mouth unobstructed", "Speech will be natural", "No expected interruption"]} value={qualityConfirm} onChange={setQualityConfirm} />
          </div>
        </section>
      )}

      {step === "record" && (
        <section className="record-shell">
          <aside className="session-panel">
            <div className="eyebrow">Participant profile</div>
            <div className="profile-row"><b>{profile.code}</b>{authVerified && <span className="verified-badge">Verified</span>}</div>

            <div className="eyebrow" style={{ marginTop: 22 }}>Your session</div><h3>{acceptedCount} of {prompts.length} saved</h3>
            <div className="progress"><i style={{ width: `${progress}%` }} /></div>
            <div className="earnings-row">
              <div><small>Participant earnings</small><b>{displayedEarnings.currency === "NGN" ? "₦" : `${displayedEarnings.currency} `}{displayedEarnings.amount.toLocaleString()}</b></div>
              <p>{displayedEarnings.standardLanguages ?? displayedEarnings.completedLanguages} regular language set{(displayedEarnings.standardLanguages ?? displayedEarnings.completedLanguages) === 1 ? "" : "s"}</p>
              <p>{displayedEarnings.safeSpeechLanguages ?? 0} NaijaSafeSpeech language set{(displayedEarnings.safeSpeechLanguages ?? 0) === 1 ? "" : "s"} completed</p>
            </div>

            <div className="prompt-list">{prompts.map((p, i) => { const completed = clips.some((c) => c.promptId === p.id); return <button type="button" key={p.id} aria-current={i === promptIndex ? "step" : undefined} onClick={() => selectPrompt(i)} className={`${i === promptIndex ? "current" : ""} ${completed ? "done" : ""}`}><span>{completed ? "✓" : i + 1}</span><div><b>{p.type}</b><small>{p.language}</small></div></button>; })}</div>
            <button className="secondary full" disabled={!clips.length} onClick={() => setStep("review")}>Review recordings ({clips.length})</button>

            <div className="quick-actions">
              <div className="eyebrow">Quick actions</div>
              <button className="quick-action" onClick={() => openCalibration("record")}><span>Re-test equipment</span><small>Mic/Cam</small></button>
              <button className="quick-action" onClick={() => setReportingPromptIssue((open) => !open)}><span>Report issue with prompt</span><small>{current.id}</small></button>
              {reportingPromptIssue && <div className="prompt-issue-form">
                <label htmlFor="prompt-issue-text">Describe the problem with {current.id}</label>
                <textarea id="prompt-issue-text" value={promptIssueText} maxLength={2000} onChange={(event) => setPromptIssueText(event.target.value)} placeholder="Tell us what is incorrect, unclear, offensive, or difficult to read." autoFocus />
                <div><button className="text-button" type="button" onClick={() => { setReportingPromptIssue(false); setPromptIssueText(""); }}>Cancel</button><button className="secondary" type="button" disabled={promptIssueText.trim().length < 3 || promptIssueSending} onClick={submitPromptIssue}>{promptIssueSending ? "Sending..." : "Submit report"}</button></div>
              </div>}
              <button className="quick-action" onClick={() => setStep("study")}><span>Privacy & study notice</span></button>
            </div>

            <button className="text-button danger" onClick={saveDraftAndExit}>Save & exit</button>
          </aside>
          <div className="record-workspace">
            <div className="prompt-header"><span className="prompt-chip">{current.type}</span><span>{current.id}</span><span className="lang-chip">{current.language}</span></div>
            <div className="record-split">
              <div className="script-panel">
                <small>{current.type === "Natural speech" ? `Answer naturally for up to ${current.responseSeconds} seconds` : current.type === "NaijaSafeSpeech" ? "Performed research prompt · optional subset" : "Read this naturally"}</small>
                <div className="script-text">{current.text}</div>
                {current.translation && <p className="script-translation">{current.translation}</p>}
                <p className="speaking-reminder">Please speak loudly and clearly while recording.</p>
              </div>
              <div className="recorder-grid">
              <div className="record-video">
                {preview ? <video src={preview.url} controls playsInline /> : <canvas ref={mouthPreviewRef} width="512" height="256" className="mouth-only-preview" />}
                {!preview && <div className="mouth-only-label">Mouth-only recording stream</div>}
                {recording && <div className="recording-badge"><i /> REC {elapsed.toFixed(1)}s</div>}
              </div>
              <div className="record-controls">
                {preview ? <>
                  <div className="quality-result"><span>✓</span><div><b>Recording captured</b><small>{preview.duration.toFixed(1)} seconds · stored only after acceptance</small></div></div>
                  <button className="primary full" disabled={savingRecording} onClick={acceptRecording}>{savingRecording ? `Saving securely${uploadProgress ? ` ${uploadProgress}%` : "..."}` : "Accept recording"}</button>
                  <button className="secondary full" onClick={() => downloadRecording(preview.blob, current.id)}>Download recording</button>
                  <button className="secondary full" onClick={redo}>Redo recording</button>
                </> : <>
                  <button className={`record-button ${recording ? "stop" : ""}`} disabled={!recording && (!cameraPassed || !audioPassed || !lightingPassed || !processedStreamRef.current)} onClick={recording ? stopRecording : beginRecording}><i />{recording ? "Stop" : "Record"}</button>
                  <p>{recording ? "Speak the prompt, then press stop." : cameraPassed && audioPassed && lightingPassed && processedStreamRef.current ? "Press record when you are ready." : "Calibration is required on this device before recording."}</p>
                  {!recording && (!cameraPassed || !audioPassed || !lightingPassed || !processedStreamRef.current) && <button className="secondary full" onClick={() => openCalibration("record")}>Run equipment calibration</button>}
                  <button className="skip" onClick={() => setPromptIndex((promptIndex + 1) % prompts.length)}>Skip this prompt</button>
                  {clips.length > 0 && <button className="skip review-shortcut" onClick={() => setStep("review")}>Review {clips.length} completed recording{clips.length === 1 ? "" : "s"}</button>}
                </>}
              </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {step === "review" && (
        <section className="shell review-shell">
          <div className="section-head"><div><div className="eyebrow">Review your recordings</div><h2>Check before you submit.</h2><p>Accepted clips are saved securely as you go. Play any clip, remove a problem recording, or return to recording. Final submission sends the complete contribution to a human reviewer.</p></div><span className="time-pill">{clips.length} clips</span></div>
          <div className="participant-review">
            <div className="review-list">
              {clips.map((clip, index) => <div className="review-row" key={clip.id}><span>{index + 1}</span><div><b>{clip.promptId} · {clip.language}</b><small>{clip.transcript}</small></div><em>{clip.duration.toFixed(1)}s</em><button className="download" onClick={() => void playSavedRecording(clip)}>Play</button><button className="download" onClick={() => void downloadSavedRecording(clip)}>Download</button><button className="download danger" onClick={async () => { if (!window.confirm(`Remove recording ${clip.promptId}? You will need to record this prompt again before submitting.`)) return; try { await removeAcceptedClip(clip); } catch { setToast("The recording could not be removed. Please try again."); return; } if (reviewMedia) { URL.revokeObjectURL(reviewMedia); setReviewMedia(""); } }}>Remove</button></div>)}
            </div>
            <aside className="review-player">{reviewMedia ? <video src={reviewMedia} controls autoPlay playsInline /> : <div><Mark>▶</Mark><p>Select a recording to play it here.</p></div>}<div className="submission-check"><b>Submission includes</b><small>Consent record, participant survey, {clips.length} recordings, calibration metrics, and recording metadata.</small></div></aside>
          </div>
          <div className="review-summary">
            <div><small>Completed</small><b>{clips.length} of {prompts.length}</b></div>
            <div><small>Still required</small><b>{Math.max(0, prompts.length - clips.length)}</b></div>
            <div><small>Compensation after approval</small><b>{displayedEarnings.amount} {displayedEarnings.currency}</b></div>
            <div><small>Payment destination</small><b>{account.bankName ? `${account.bankName} ···· ${account.accountNumber.slice(-4)}` : "Saved payment account"}</b></div>
          </div>
          <div className="notice"><Mark>i</Mark><p><b>Payment follows approval.</b> Submit only after checking the recordings. A reviewer validates the files first, then an administrator processes compensation to the payment destination shown above.</p></div>
          {uploadProgress > 0 && uploadProgress < 100 && <div className="upload-progress"><i style={{ width: `${uploadProgress}%` }} /><span>Uploading securely: {uploadProgress}%</span></div>}
          <div className="footer-actions"><button className="secondary" onClick={returnToRecording}>{clips.length === prompts.length ? "Return to recordings" : "Record next missing prompt"}</button><button className="primary" disabled={clips.length !== prompts.length || (uploadProgress > 0 && uploadProgress < 100)} onClick={uploadAndFinalizeSubmission}>Submit for review and payment <span>→</span></button></div>
          {clips.length !== prompts.length && <p className="submission-warning">Complete all {prompts.length} required prompts or remove and re-record missing clips before submitting.</p>}
        </section>
      )}

      {step === "complete" && (
        <section className="shell narrow complete">
          <div className="complete-mark">✓</div><div className="eyebrow">Submission received</div><h2>Your recordings are awaiting review.</h2>
          <p>Your submission is not yet approved for payment. A reviewer will check recording quality, prompt accuracy, privacy, duplication, and eligibility.</p>
          {backendSubmissionStatus && <span className="status needs-review">Current status: {backendSubmissionStatus.replaceAll("_", " ")}</span>}
          {notifications.length > 0 && <div className="notification-list">{notifications.map((notice) => <div key={notice.id}><b>{notice.title}</b><p>{notice.message}</p></div>)}</div>}
          <div className="summary-grid"><div><b>{clips.length}</b><span>clips recorded</span></div><div><b>{clips.reduce((n, c) => n + c.duration, 0).toFixed(1)}s</b><span>total duration</span></div><div><b>{new Set(clips.map((c) => c.language)).size}</b><span>language groups</span></div></div>
          <div className="status-timeline"><div className="done"><span>✓</span><b>Submitted</b></div><i /><div className={reviewStatus === "approved" ? "done" : "active"}><span>{reviewStatus === "approved" ? "✓" : "2"}</span><b>Human validation</b></div><i /><div className={paymentStatus === "approved" ? "done" : ""}><span>3</span><b>Compensation</b></div></div>
          <div className="feedback-card">
            <h3>Participant feedback</h3>
            <div className="form-grid">
              <label><span>Was the recording process easy?</span><select value={profile.feedbackEase} onChange={(e) => setProfile({ ...profile, feedbackEase: e.target.value })}><option value="">Select a response</option>{["Very Easy","Easy","Neutral","Difficult","Very Difficult"].map((item) => <option key={item}>{item}</option>)}</select></label>
              <label><span>Any technical problems? <small>optional</small></span><textarea value={profile.technicalProblems} onChange={(e) => setProfile({ ...profile, technicalProblems: e.target.value })} /></label>
              <label className="wide"><span>Additional comments <small>optional</small></span><textarea value={profile.comments} onChange={(e) => setProfile({ ...profile, comments: e.target.value })} /></label>
            </div>
          </div>
          <details className="withdrawal-card"><summary>Request withdrawal or deletion</summary>{withdrawalRequested ? <p>Your request has been recorded. An administrator will review it and confirm what can be removed.</p> : <><p>You may request withdrawal before publication. Removal may be limited after an approved dataset release.</p><textarea value={withdrawalReason} onChange={(e) => setWithdrawalReason(e.target.value)} placeholder="Optional reason" /><button className="secondary" onClick={requestWithdrawal}>Submit withdrawal request</button></>}</details>
          <button className="primary" onClick={() => setStep("welcome")}>Finish contribution</button>
        </section>
      )}

      {step === "reviewer" && (
        <section className="admin-shell">
          <div className="admin-title"><div><div className="eyebrow">{currentRole === "admin" && adminWorkspaceView === "operations" ? "Administrator controls" : "Human validation"}</div><h1>{currentRole === "admin" ? adminWorkspaceView === "operations" ? "Administrator workspace" : "Review workspace" : "Reviewer workspace"}</h1><p>{currentRole === "admin" && adminWorkspaceView === "operations" ? "Manage roles, assignments, compensation, risk, withdrawals, and dataset releases." : "Review submitted media and send a documented recommendation. Administrators make final decisions and control compensation."}</p></div></div>
          {currentRole === "admin" && <div className="workspace-tabs"><button className={adminWorkspaceView === "reviews" ? "active" : ""} onClick={() => setAdminWorkspaceView("reviews")}>Submission reviews</button><button className={adminWorkspaceView === "operations" ? "active" : ""} onClick={() => setAdminWorkspaceView("operations")}>Administration</button></div>}
          {(currentRole !== "admin" || adminWorkspaceView === "reviews") && <>
          <section className="reviewer-overview">
            <div className="metric-grid reviewer-metrics"><div><span>Rate per video</span><b>₦{reviewerRate.amount.toLocaleString()}</b><small>Each unique video reviewed</small></div><div><span>Videos reviewed</span><b>{reviewerVideoCount}</b><small>Across {reviewerPayments.length} participant submissions</small></div><div><span>Total earned</span><b>₦{reviewerTotalEarned.toLocaleString()}</b><small>Paid and pending reviewer fees</small></div><div><span>Awaiting payment</span><b>₦{reviewerPending.toLocaleString()}</b><small>₦{reviewerPaid.toLocaleString()} paid to date</small></div></div>
            <div className="reviewer-account-strip"><div><small>Assigned work</small><b>{reviewQueue.length} submissions currently in your review queue</b></div><div><small>Payment destination</small><b>{reviewerPayout ? `${reviewerPayout.bank_name} ending ${reviewerPayout.account_last4}` : "No verified payment account"}</b></div><a className="secondary" href={`${BASE_PATH}/?contribute=1&payment=edit`}>{reviewerPayout ? "Update payment details" : "Add payment details"}</a></div>
            <p className="reviewer-rate-example">Example: 50 videos × ₦10 = ₦500. Reviewer earnings are separate from participant compensation.</p>
          </section>
          {backendConfigured && <div className="submission-selector"><label><span>{currentRole === "admin" ? "Select a participant submission" : "Select an assigned submission"}</span><select value={selectedReviewId} onChange={(event) => event.target.value ? selectReviewerSubmission(event.target.value) : setSelectedReviewId("")}><option value="">Choose a submission</option>{reviewQueue.map((item) => <option key={item.id} value={item.id}>{item.participant_id} | {item.status.replaceAll("_", " ")} | {item.expected_recordings} recordings | {new Date(item.created_at).toLocaleDateString()}</option>)}</select></label>{reviewQueue.length === 0 && <p>{currentRole === "admin" ? "No submissions are awaiting action." : "No submissions are assigned to you yet. An administrator must assign one first."}</p>}</div>}
          {selectedReviewId ? <>
          <div className="selected-submission-banner"><span>Currently reviewing</span><b>{selectedReviewSubmission?.participant_id || "Unknown participant"}</b><small>Submission {selectedReviewId.slice(0, 8)} | {selectedReviewSubmission?.status.replaceAll("_", " ")}</small></div>
          <div className="metric-grid"><div><span>Participant</span><b className="small-metric">{selectedReviewSubmission?.participant_id || "Unknown"}</b><small>pseudonymous ID</small></div><div><span>Recordings</span><b>{reviewerRecords.length}</b><small>of {selectedReviewSubmission?.expected_recordings || 0} expected</small></div><div><span>Clip decisions</span><b className="small-metric">{reviewerRecords.filter((record) => record.review_decision).length} of {reviewerRecords.length}</b><small>reviewed individually</small></div><div><span>Final status</span><b className="small-metric">{selectedReviewSubmission?.status.replaceAll("_", " ")}</b><small>administrator controlled</small></div></div>
          <div className="review-media-layout">
          <div className="data-card">
            <div className="table-head"><div><h3>Submission media</h3><p>Check prompt accuracy, mouth-only framing, audio quality, duplicates, and private information.</p></div></div>
            <div className="table-wrap"><table><thead><tr><th>Prompt</th><th>Language</th><th>Type</th><th>Duration</th><th>Quality</th><th>Media</th><th>Decision</th></tr></thead><tbody>{backendConfigured ? reviewerRecords.map((record) => <tr key={record.id}><td><b>{record.prompt_id}</b></td><td>{record.language}</td><td>{prompts.find((prompt) => prompt.id === record.prompt_id)?.type}</td><td>{Number(record.duration_seconds).toFixed(1)}s</td><td><span className={`status ${record.review_decision || "needs-review"}`}>{record.review_decision?.replaceAll("_", " ") || record.quality_status}</span></td><td><button className="download" disabled={!record.signed_url} onClick={() => setReviewMedia(record.signed_url)}>Watch</button></td><td><div className="recording-decisions"><button className={`download ${record.review_decision === "approved" ? "selected" : ""}`} onClick={() => reviewRecording(record.id, "approved")}>Approve</button><button className={`download danger ${record.review_decision === "rejected" ? "selected" : ""}`} onClick={() => reviewRecording(record.id, "rejected")}>Decline</button><button className={`download redo ${record.review_decision === "changes_requested" ? "selected" : ""}`} onClick={() => reviewRecording(record.id, "changes_requested")}>Redo</button></div></td></tr>) : clips.map((clip) => { const decision = localRecordingReviews[clip.id]; return <tr key={clip.id}><td><b>{clip.promptId}</b><small>{clip.transcript}</small></td><td>{clip.language}</td><td>{prompts.find((prompt) => prompt.id === clip.promptId)?.type}</td><td>{clip.duration.toFixed(1)}s</td><td><span className={`status ${decision || clip.status}`}>{decision === "approved" ? "approved" : decision === "rejected" ? "declined" : decision === "changes_requested" ? "redo requested" : clip.status}</span></td><td><button className="download" onClick={() => { if (reviewMedia) URL.revokeObjectURL(reviewMedia); setReviewMedia(URL.createObjectURL(clip.blob)); }}>Watch</button></td><td><div className="recording-decisions"><button className="download" onClick={() => reviewRecording(clip.id, "approved")}>Approve</button><button className="download danger" onClick={() => reviewRecording(clip.id, "rejected")}>Decline</button><button className="download redo" onClick={() => reviewRecording(clip.id, "changes_requested")}>Redo</button></div></td></tr>; })}</tbody></table></div>
          </div>
          <aside className="reviewer-media"><div className="reviewer-media-heading"><b>Video preview</b><small>Select Watch beside any recording</small></div>{reviewMedia ? <video src={reviewMedia} controls autoPlay playsInline /> : <div className="reviewer-media-empty">No video selected</div>}</aside>
          </div>
          {currentRole === "reviewer" ? <div className="review-decision recommendation-panel"><div><h3>Reviewer recommendation</h3>{reviewRecommendation?.admin_review_status === "returned" && <div className="info-banner"><b>Administrator returned this review</b><p>{reviewRecommendation.admin_feedback}</p></div>}<p>{everyRecordingReviewed ? "All recordings have a decision. Request redo for problem clips or recommend approval when every clip passes." : `Review every recording first. ${reviewerRecords.filter((record) => !record.review_decision).length} still need a decision.`}</p><label className="return-comment-field"><span>Comments for the administrator or participant</span><small>Required when returning recordings. Explain what needs to be corrected.</small><textarea value={reviewComments} onChange={(event) => setReviewComments(event.target.value)} placeholder="For example: Please record the marked clips again in a quieter room." /></label></div><button className="secondary" disabled={!hasRecordingForRedo || reviewComments.trim().length < 10} title={!hasRecordingForRedo ? "Mark at least one recording for redo first" : reviewComments.trim().length < 10 ? "Add a return comment of at least 10 characters" : ""} onClick={() => reviewRecommendation?.admin_review_status === "returned" ? returnClipsToParticipant() : submitReviewRecommendation("changes_requested")}>{reviewRecommendation?.admin_review_status === "returned" ? "Return clips to participant" : "Send redo recommendation"}</button><button className="primary" disabled={!everyRecordingApproved} title={!everyRecordingApproved ? "Every recording must be approved first" : ""} onClick={() => submitReviewRecommendation("approved")}>Recommend approval</button></div> : <div className="review-decision"><div><h3>Administrator final decision</h3><p>{reviewRecommendation ? `Reviewer recommendation: ${reviewRecommendation.recommendation.replaceAll("_", " ")}. ${reviewRecommendation.comments || "No reviewer comments."}` : "A reviewer recommendation is required for approval. Full rejection is reserved for serious account-level or consent issues."}</p>{reviewRecommendation?.admin_review_status === "returned" && <p><b>Returned to reviewer:</b> {reviewRecommendation.admin_feedback}</p>}<label className="return-comment-field"><span>Administrator comments</span><small>Required when returning a review or rejecting a submission.</small><textarea value={adminDecisionComments} onChange={(event) => setAdminDecisionComments(event.target.value)} placeholder="Explain what the reviewer must correct or why the full submission is being rejected." /></label></div><button className="secondary" disabled={!reviewRecommendation || adminDecisionComments.trim().length < 10 || reviewRecommendation.admin_review_status === "returned"} title={adminDecisionComments.trim().length < 10 ? "Enter feedback of at least 10 characters" : ""} onClick={() => { if (window.confirm(`Return this recommendation to the reviewer assigned to ${selectedReviewSubmission?.participant_id}?`)) returnRecommendationToReviewer(); }}>Return review to reviewer</button><button className="secondary danger-border" disabled={adminDecisionComments.trim().length < 10} title={adminDecisionComments.trim().length < 10 ? "Enter an account-level reason of at least 10 characters" : ""} onClick={() => { if (window.confirm(`Reject the entire submission from ${selectedReviewSubmission?.participant_id}? Use this only for an account-level, consent, fraud, or eligibility issue.`)) makeReviewDecision("rejected", adminDecisionComments); }}>Reject entire submission</button><button className="primary" disabled={reviewRecommendation?.recommendation !== "approved" || reviewRecommendation.admin_review_status === "returned"} title={reviewRecommendation?.admin_review_status === "returned" ? "The reviewer must respond to the returned review first" : reviewRecommendation?.recommendation !== "approved" ? "A reviewer approval recommendation is required" : ""} onClick={() => { if (window.confirm(`Give final approval to submission ${selectedReviewId.slice(0, 8)} from ${selectedReviewSubmission?.participant_id}?`)) makeReviewDecision("approved", adminDecisionComments); }}>Final approval</button><button className="primary payment" disabled={selectedReviewSubmission?.status !== "payment_eligible"} onClick={approvePayment}>Process payment</button></div>}
          </> : <div className="empty-workspace"><h3>Select a submission</h3><p>Choose an item from the queue to inspect its recordings and review history.</p></div>}
          </>}
          {currentRole === "admin" && adminWorkspaceView === "operations" && <AdminOperations />}
        </section>
      )}

      {toast && <div className="toast">✓ {toast}</div>}
      <footer><span>NaijaVision Research Infrastructure</span><span>Open multilingual contribution platform</span></footer>
    </main>
  );
}
