import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { DisplaySettings } from '@/components/display-settings';
createRoot(document.getElementById('root')!).render(<footer><DisplaySettings align="right" /></footer>);
