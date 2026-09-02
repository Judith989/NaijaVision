import * as tus from "tus-js-client";
import { getSupabase } from "./supabase";

export type UploadProgress = {
  uploaded: number;
  total: number;
  percentage: number;
};

export async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function uploadRecording(
  userId: string,
  submissionId: string,
  recordingId: string,
  blob: Blob,
  onProgress: (progress: UploadProgress) => void,
): Promise<string> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Authentication is required.");

  const projectHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).host;
  const projectId = projectHost.split(".")[0];
  const contentType = (blob.type || "video/webm").split(";", 1)[0].trim().toLowerCase();
  const extension = contentType === "video/mp4" ? "mp4" : "webm";
  const objectName = `${userId}/${submissionId}/${recordingId}.${extension}`;
  const uploadBlob = blob.type === contentType ? blob : new Blob([blob], { type: contentType });

  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(uploadBlob, {
      endpoint: `https://${projectId}.storage.supabase.co/storage/v1/upload/resumable`,
      retryDelays: [0, 1000, 3000, 5000, 10000, 20000],
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "x-upsert": "false",
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: "raw-recordings",
        objectName,
        contentType,
        cacheControl: "no-store",
      },
      onError: reject,
      onProgress(uploaded, total) {
        onProgress({ uploaded, total, percentage: total ? Math.round((uploaded / total) * 100) : 0 });
      },
      onSuccess: () => resolve(),
    });
    upload.findPreviousUploads().then((previous) => {
      if (previous.length) upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    }).catch(reject);
  });

  return objectName;
}

