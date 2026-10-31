import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { StudioEditor } from '@/components/studio-editor';
import { ToastProvider } from '@/components/toast';

const library = [{ id: '11111111-1111-4111-8111-111111111111', label: 'Library clip', bytes: 12345, duration: 3, width: 320, height: 180 }];
createRoot(document.getElementById('root')!).render(<ToastProvider><main><StudioEditor library={library} /></main></ToastProvider>);
