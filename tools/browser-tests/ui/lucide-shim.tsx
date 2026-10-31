import * as React from 'react';
const mk = (name: string) => (p: any) => React.createElement('svg', { 'data-icon': name, 'aria-hidden': p['aria-hidden'], className: p.className, width: 16, height: 16 });
export const Pause = mk('Pause'), Play = mk('Play'), Plus = mk('Plus'), Redo2 = mk('Redo2'), Scissors = mk('Scissors'), Type = mk('Type'), Undo2 = mk('Undo2'),
  ArrowLeft = mk('ArrowLeft'), ArrowRight = mk('ArrowRight'), Trash2 = mk('Trash2'), Upload = mk('Upload'), Download = mk('Download'), Film = mk('Film'),
  AlertCircle = mk('AlertCircle'), CheckCircle2 = mk('CheckCircle2'), Info = mk('Info'), TriangleAlert = mk('TriangleAlert'), X = mk('X');
