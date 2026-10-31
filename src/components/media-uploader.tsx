'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Upload } from 'lucide-react';
import { registerMedia, requestMediaUpload } from '@/actions/publish';
import { ProgressBar } from '@/components/progress-bar';
import { useToast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { putWithProgress } from '@/lib/client/upload';
import { ALLOWED_UPLOAD_MIME, MEDIA_MAX_BYTES } from '@/lib/media-sniff';

function imageSize(file: File): Promise<{ width?: number; height?: number }> {
  if (!file.type.startsWith('image/')) return Promise.resolve({});
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = () => { resolve({}); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

export function MediaUploader({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [current, setCurrent] = useState<{ name: string; pct: number } | null>(null);

  async function handle(files: FileList | null) {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      if (!(ALLOWED_UPLOAD_MIME as readonly string[]).includes(file.type)) { toast.push('error', `${file.name}: use JPEG, PNG or WebP images, or MP4 or MOV video.`); continue; }
      if (file.size > MEDIA_MAX_BYTES) { toast.push('error', `${file.name} is larger than ${Math.round(MEDIA_MAX_BYTES / 1_048_576)} MB.`); continue; }
      setCurrent({ name: file.name, pct: 0 });
      const asked = await requestMediaUpload({ mime: file.type, bytes: file.size });
      if (!asked.ok || !asked.data) { toast.push('error', asked.ok ? 'Could not prepare the upload.' : asked.error); continue; }
      const uploaded = await putWithProgress(asked.data.uploadUrl, file, (pct) => setCurrent({ name: file.name, pct }));
      if (!uploaded) { toast.push('error', `${file.name}: the upload failed. Check your connection and try again.`); continue; }
      const size = await imageSize(file);
      const reg = await registerMedia({ path: asked.data.path, label: file.name, ...size });
      toast.push(reg.ok ? 'success' : 'error', reg.ok ? `${file.name} added.` : reg.error);
    }
    setCurrent(null);
    if (input.current) input.current.value = '';
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <input ref={input} type="file" className="sr-only" tabIndex={-1} aria-label="Choose images or videos to upload" id="media-file" multiple accept={ALLOWED_UPLOAD_MIME.join(',')} onChange={(e) => void handle(e.target.files)} disabled={current !== null} />
      <Button type="button" variant={compact ? 'outline' : 'default'} size={compact ? 'sm' : 'default'} onClick={() => input.current?.click()} disabled={current !== null}>
        <Upload aria-hidden="true" /> {current ? 'Uploading…' : 'Upload images or video'}
      </Button>
      {current ? <ProgressBar percent={current.pct} label={`Uploading ${current.name}`} /> : null}
      {!compact ? <p className="text-xs text-muted-foreground">JPEG, PNG, WebP, MP4 or MOV, up to {Math.round(MEDIA_MAX_BYTES / 1_048_576)} MB each. Instagram photos must be JPEG.</p> : null}
    </div>
  );
}
