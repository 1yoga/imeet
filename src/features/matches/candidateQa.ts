import type { ReplySession } from '@/features/conversation/useAndroidVoiceInput';

import { byGender, type Candidate } from './candidates';

/**
 * Тестовые ответы агента о кандидате (до бэкенда): ищем факт по ключевым словам вопроса,
 * иначе честно говорим, что не знаем, и предлагаем спросить лично.
 */
export function createCandidateQa(candidate: Candidate): ReplySession {
  const unknown = [
    `Этого я пока не знаю. Могу *уточнить* у ${candidate.nameGenitive} и вернуться с ответом.`,
    `Хороший вопрос! ${candidate.name} об этом не ${byGender(candidate, 'рассказывала', 'рассказывал')} — можно спросить ${byGender(candidate, 'её', 'его')} *лично* в чате.`,
    `Здесь у меня нет данных. Спросите о чём-нибудь ещё или напишите ${byGender(candidate, 'ей', 'ему')} *сами*.`,
  ];
  let miss = 0;
  return {
    replyTo(text: string) {
      const fact = candidate.facts.find(({ pattern }) => pattern.test(text));
      if (fact) return fact.answer;
      const answer = unknown[miss % unknown.length];
      miss += 1;
      return answer;
    },
  };
}
