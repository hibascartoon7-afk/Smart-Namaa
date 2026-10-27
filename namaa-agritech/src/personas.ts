import type { Persona } from './types';

export const PERSONAS: Record<Persona, { name: string; arabic: string; role: string; accent: string }> = {
  ghaith: { name: 'Ghaith', arabic: 'غيث', role: 'Irrigation & water guide', accent: '#105666' },
  nada: { name: 'Nada', arabic: 'ندى', role: 'Soil & fertilization guide', accent: '#D3968C' },
};

// Generic prompts only: they never name a sensor, crop or number.
export const SUGGESTED_PROMPTS: Record<Persona, string[]> = {
  ghaith: [
    'Should I irrigate today?',
    'How does the coming rain change my irrigation plan?',
    'Why was irrigation delayed?',
    'هل أسقي اليوم؟',
    'كيف يؤثر المطر القادم على الري؟',
  ],
  nada: [
    'Which soil variables are not measured today?',
    'What do I need to measure before deciding on fertilizer?',
    'What does a high EC mean for my crop?',
    'ما المتغيرات التي لم تُقَس اليوم؟',
    'ماذا أحتاج أن أقيس قبل قرار التسميد؟',
  ],
};
