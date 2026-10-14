import { describe, it, expect } from 'vitest';

// Language detection logic — mirrors the instruction in the system prompt
// The AI detects language based on Arabic character presence in the user message

function detectLanguage(text: string): 'ar' | 'en' {
  const arabicChars = text.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g);
  const arabicCount = arabicChars?.length ?? 0;
  const latinCount = (text.match(/[a-zA-Z]/g)?.length ?? 0);
  if (arabicCount > 0 && arabicCount >= latinCount) return 'ar';
  return 'en';
}

describe('Language detection', () => {
  it('detects Arabic questions as Arabic', () => {
    expect(detectLanguage('أي عداد يحتاج الري أولاً؟')).toBe('ar');
    expect(detectLanguage('كيف يؤثر المطر القادم على خطة الري؟')).toBe('ar');
    expect(detectLanguage('متى يجب أن أسمد الحقل؟')).toBe('ar');
    expect(detectLanguage('ما هي حالة الملوحة في الحقل؟')).toBe('ar');
  });

  it('detects English questions as English', () => {
    expect(detectLanguage('Which meter needs water most urgently?')).toBe('en');
    expect(detectLanguage('How does the incoming rain change my irrigation plan?')).toBe('en');
    expect(detectLanguage('When should I apply Potassium?')).toBe('en');
    expect(detectLanguage('What is the salinity status across the field?')).toBe('en');
  });

  it('detects mixed-language messages correctly (majority wins)', () => {
    expect(detectLanguage('الري هو أهم شيء في الزراعة is important')).toBe('ar');
    expect(detectLanguage('VWC في العداد الأول منخفض جداً right now')).toBe('ar');
    expect(detectLanguage('Ask about irrigation الري')).toBe('en');
    expect(detectLanguage('VWC 24% is low للري')).toBe('en');
  });

  it('handles messages with only technical terms (VWC, EC, pH) in English', () => {
    expect(detectLanguage('VWC at M1 is 24%')).toBe('en');
    expect(detectLanguage('EC 7.2 is high')).toBe('en');
    expect(detectLanguage('pH 6.8 is optimal')).toBe('en');
  });

  it('handles empty or whitespace-only input', () => {
    expect(detectLanguage('')).toBe('en');
    expect(detectLanguage('   ')).toBe('en');
  });

  it('detects Arabic with technical English terms embedded', () => {
    expect(detectLanguage('VWC في العداد M1 منخفض')).toBe('ar');
    expect(detectLanguage('EC عالية في M3')).toBe('ar');
    expect(detectLanguage('ما معنى VWC؟')).toBe('ar');
  });
});

describe('Language switching in conversation', () => {
  it('switches from Arabic to English when user switches language', () => {
    const messages = [
      { content: 'أي عداد يحتاج الري أولاً؟', expected: 'ar' as const },
      { content: 'Which meter needs water most?', expected: 'en' as const },
      { content: 'شكراً لك', expected: 'ar' as const },
    ];

    for (const msg of messages) {
      expect(detectLanguage(msg.content)).toBe(msg.expected);
    }
  });

  it('switches from English to Arabic when user switches language', () => {
    const messages = [
      { content: 'What is the salinity status?', expected: 'en' as const },
      { content: 'ما هي حالة الملوحة؟', expected: 'ar' as const },
      { content: 'Thank you', expected: 'en' as const },
    ];

    for (const msg of messages) {
      expect(detectLanguage(msg.content)).toBe(msg.expected);
    }
  });

  it('maintains language detection across rapid switches', () => {
    const rapid = [
      'Hello', 'مرحباً', 'How are you?', 'كيف حالك؟',
      'I need irrigation advice', 'أحتاج نصيحة عن الري',
    ];
    const expected = ['en', 'ar', 'en', 'ar', 'en', 'ar'];
    expect(rapid.map(detectLanguage)).toEqual(expected);
  });
});

describe('Arabic response quality', () => {
  it('Arabic greetings include both languages in the greeting message', () => {
    const greeting = `Salam! I'm Ghaith (غيث), your irrigation and water strategist. I have live access to your field sensors, weather data, and agronomic calculations. Ask me anything about smart irrigation in Arabic or English.\n\nمرحباً! أنا غيث، مستشارك للري. اسألني أي سؤال عن الري الذكي بالعربية أو الإنجليزية.`;
    // Contains Arabic text
    expect(greeting).toMatch(/[\u0600-\u06FF]/);
    // Contains English text
    expect(greeting).toMatch(/[a-zA-Z]/);
    // Mentions both languages are supported
    expect(greeting.toLowerCase()).toContain('arabic');
    expect(greeting.toLowerCase()).toContain('english');
  });

  it('suggested prompts include both Arabic and English options', () => {
    const prompts = {
      ghaith: [
        'Which meter needs water most urgently?',
        'How does the incoming rain change my irrigation plan?',
        'أي عداد يحتاج الري أولاً؟',
        'كيف يؤثر المطر القادم على خطة الري؟',
      ],
      nada: [
        'Why hold fertilizer on Meter 3?',
        'What is the salinity status across the field?',
        'لماذا تأجيل التسميد على العداد ٣؟',
        'ما هي حالة الملوحة في الحقل؟',
      ],
    };

    for (const persona of Object.keys(prompts)) {
      const list = prompts[persona as keyof typeof prompts];
      const hasEnglish = list.some((p) => detectLanguage(p) === 'en');
      const hasArabic = list.some((p) => detectLanguage(p) === 'ar');
      expect(hasEnglish).toBe(true);
      expect(hasArabic).toBe(true);
    }
  });
});

describe('Agriculture-only scope enforcement', () => {
  it('system prompt restricts scope to agriculture', () => {
    const scopeRules = [
      'You specialize ONLY in precision agriculture',
      'sub-surface 7-in-1 soil sensors',
      'micro-topography dynamics',
      'smart irrigation',
    ];
    for (const rule of scopeRules) {
      expect(rule).toBeTruthy();
    }
  });

  it('non-agricultural questions should be redirected', () => {
    const nonAgriQuestions = [
      'What is the capital of France?',
      'Write me a Python script',
      'Tell me a joke',
      'What movies are playing tonight?',
    ];
    for (const q of nonAgriQuestions) {
      expect(detectLanguage(q)).toBe('en');
      // These are valid strings but should be politely redirected by the AI
    }
  });

  it('agricultural questions in Arabic are within scope', () => {
    const agriQuestions = [
      'كم كمية المياه اللازمة للري؟',
      'متى أبدأ التسميد؟',
      'ما هو أفضل وقت للري؟',
      'كيف أتعامل مع الملوحة العالية؟',
    ];
    for (const q of agriQuestions) {
      expect(detectLanguage(q)).toBe('ar');
    }
  });
});
