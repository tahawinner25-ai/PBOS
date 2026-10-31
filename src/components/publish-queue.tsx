import { CheckCircle2, CircleAlert, Clock } from 'lucide-react';
import { approveJob, cancelJob, deleteJob, resolveReview, retryJob } from '@/actions/publish';
import { ActionButton } from '@/components/action-button';
import { ProgressBar } from '@/components/progress-bar';
import { YouTubeUploader } from '@/components/youtube-uploader';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/format';
import { describeApproval } from '@/lib/publish-form';
import type { JobFormat, JobStatus } from '@/lib/integrations/types';

export type QueueJob = {
  id: string; platform: 'youtube' | 'instagram'; format: JobFormat; title: string | null; caption: string | null; privacy: 'public' | 'unlisted' | 'private'; scheduled_for: string | null;
  media_asset_ids: string[]; status: JobStatus; progress: number; upload_offset: number; external_url: string | null; last_error: string | null; error_code: string | null; created_at: string; published_at: string | null;
};

const STATUS: Record<JobStatus, { label: string; variant: 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive' }> = {
  draft: { label: 'Draft — not approved', variant: 'outline' },
  scheduled: { label: 'Approved', variant: 'default' },
  uploading: { label: 'Uploading', variant: 'default' },
  processing: { label: 'Processing', variant: 'default' },
  platform_scheduled: { label: 'Scheduled on YouTube', variant: 'success' },
  published: { label: 'Published', variant: 'success' },
  failed: { label: 'Failed', variant: 'destructive' },
  needs_review: { label: 'Check needed', variant: 'warning' },
  cancelled: { label: 'Cancelled', variant: 'secondary' },
};

const FORMAT: Record<string, string> = { video: 'YouTube video', short: 'YouTube Short', reel: 'Instagram Reel', photo: 'Instagram photo', carousel: 'Instagram carousel' };

export function PublishQueue({ jobs }: { jobs: QueueJob[] }) {
  return (
    <ul className="space-y-3">
      {jobs.map((job) => {
        const s = STATUS[job.status];
        const waitingForFile = job.platform === 'youtube' && (job.status === 'scheduled' || job.status === 'uploading');
        return (
          <li key={job.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{job.title ?? (job.caption ? job.caption.slice(0, 80) : 'Untitled post')}</p>
                <p className="text-xs text-muted-foreground">
                  {FORMAT[job.format] ?? job.format}
                  {job.scheduled_for ? ` · ${job.status === 'published' ? 'was scheduled for' : 'scheduled for'} ${new Date(job.scheduled_for).toUTCString()}` : ''}
                  {job.platform === 'youtube' ? ` · ${job.privacy}` : ''}
                </p>
              </div>
              <Badge variant={s.variant}>
                {job.status === 'published' || job.status === 'platform_scheduled' ? <CheckCircle2 aria-hidden="true" className="size-3" /> : job.status === 'failed' || job.status === 'needs_review' ? <CircleAlert aria-hidden="true" className="size-3" /> : job.status === 'scheduled' ? <Clock aria-hidden="true" className="size-3" /> : null}
                {s.label}
              </Badge>
            </div>

            {job.last_error && job.status !== 'published' ? <p role={job.status === 'failed' || job.status === 'needs_review' ? 'alert' : undefined} className="mt-2 text-sm text-muted-foreground">{job.last_error}</p> : null}
            {job.error_code === 'kept_private' ? <p className="mt-2 text-sm text-warning">{job.last_error}</p> : null}
            {job.status === 'published' && job.last_error && job.error_code !== 'kept_private' ? <p className="mt-2 text-xs text-muted-foreground">{job.last_error}</p> : null}
            {(job.status === 'uploading' || job.status === 'processing') && job.platform === 'instagram' ? <ProgressBar className="mt-3" percent={job.progress} label="Publishing to Instagram" /> : null}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {job.status === 'draft' ? (
                <ActionButton size="sm" action={approveJob.bind(null, job.id)} pendingLabel="Approving…" confirm={describeApproval(job)}>Approve and post</ActionButton>
              ) : null}
              {job.status === 'failed' ? <ActionButton size="sm" variant="secondary" action={retryJob.bind(null, job.id)}>Retry</ActionButton> : null}
              {job.status === 'needs_review' ? (
                <>
                  <ActionButton size="sm" variant="secondary" action={resolveReview.bind(null, job.id, 'posted')} confirm="Only choose this after checking your profile and seeing the post live.">I checked: it is live</ActionButton>
                  <ActionButton size="sm" variant="secondary" action={resolveReview.bind(null, job.id, 'not_posted')} confirm="Only choose this after checking your profile and confirming the post is NOT there. PBOS will publish it once more.">I checked: it is not there</ActionButton>
                </>
              ) : null}
              {['draft', 'scheduled', 'processing', 'failed'].includes(job.status) ? <ActionButton size="sm" variant="ghost" action={cancelJob.bind(null, job.id)} confirm="Cancel this post? Nothing will be posted.">Cancel</ActionButton> : null}
              {['draft', 'cancelled', 'failed'].includes(job.status) ? <ActionButton size="sm" variant="ghost" action={deleteJob.bind(null, job.id)} confirm="Delete this post permanently?">Delete</ActionButton> : null}
              {job.external_url && (job.status === 'published' || job.status === 'platform_scheduled') ? <a className="text-sm underline" href={job.external_url} target="_blank" rel="noreferrer noopener">View on {job.platform === 'youtube' ? 'YouTube' : 'Instagram'}</a> : null}
              {job.published_at && job.status === 'published' ? <span className="text-xs text-muted-foreground">{formatDate(job.published_at)}</span> : null}
            </div>

            {waitingForFile ? <div className="mt-3 border-t border-border pt-3"><YouTubeUploader jobId={job.id} resumeFrom={job.upload_offset} /></div> : null}
          </li>
        );
      })}
    </ul>
  );
}
