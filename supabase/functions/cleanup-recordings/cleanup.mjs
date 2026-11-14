export async function cleanupRecordings(service) {
  const { data: jobs, error } = await service.rpc('claim_recording_deletions');
  if (error) throw error;
  let deleted = 0;
  let failed = 0;
  for (const job of jobs || []) {
    let failure = null;
    try {
      const prefix = `${job.user_id}/${job.submission_id}/`;
      if (!job.object_path.startsWith(prefix) || job.object_path.includes('..')) throw new Error('Unexpected recording path');
      const result = await service.storage.from('raw-recordings').remove([job.object_path]);
      if (result.error) throw result.error;
    } catch {
      failure = 'Storage deletion failed; will retry automatically.';
    }
    const saved = await service.rpc('finish_recording_deletion', {
      p_id: job.id, p_lease_id: job.lease_id, p_error: failure,
    });
    if (saved.error) throw saved.error;
    if (failure) failed++; else deleted++;
  }
  return { deleted, failed };
}
