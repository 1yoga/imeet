import type { ImageSourcePropType } from 'react-native';

/** Иконки тегов: линейные SVG из assets/icons/ui. */
export const traitIcons = {
  smile: require('../../../assets/icons/ui/smile.svg'),
  thumbsUp: require('../../../assets/icons/ui/thumbs-up.svg'),
  graduation: require('../../../assets/icons/ui/graduation.svg'),
  heart: require('../../../assets/icons/ui/heart.svg'),
  leaf: require('../../../assets/icons/ui/leaf.svg'),
  mountain: require('../../../assets/icons/ui/mountain.svg'),
  bowl: require('../../../assets/icons/ui/bowl.svg'),
  snowflake: require('../../../assets/icons/ui/snowflake.svg'),
} as const;

export interface Trait {
  icon: keyof typeof traitIcons;
  label: string;
}

/** Что агент «знает» о кандидате: ключевые слова вопроса → ответ. Звёздочки — логическое ударение. */
export interface CandidateFact {
  pattern: RegExp;
  answer: string;
}

export interface Candidate {
  id: string;
  name: string;
  /** Имя в родительном падеже: «Уточнить у Валерии». */
  nameGenitive: string;
  age: number;
  city: string;
  avatar: ImageSourcePropType;
  photos: ImageSourcePropType[];
  /** Короткие описания для карточки. */
  about: string;
  interestsText: string;
  traits: Trait[];
  interests: Trait[];
  facts: CandidateFact[];
}

export function ageLabel(age: number) {
  const tens = age % 100;
  const ones = age % 10;
  if (tens >= 11 && tens <= 14) return `${age} лет`;
  if (ones === 1) return `${age} год`;
  if (ones >= 2 && ones <= 4) return `${age} года`;
  return `${age} лет`;
}

// Тестовые данные прототипа: фото вырезаны из макетов Figma, их стоит заменить оригиналами.
export const candidates: Candidate[] = [
  {
    id: 'valeria',
    name: 'Валерия',
    nameGenitive: 'Валерии',
    age: 28,
    city: 'Казань',
    avatar: require('../../../assets/candidates/valeria-avatar.jpg'),
    photos: [
      require('../../../assets/candidates/valeria-1.jpg'),
      require('../../../assets/candidates/valeria-2.jpg'),
      require('../../../assets/candidates/valeria-avatar.jpg'),
    ],
    about: 'Спокойная, самодостаточная готовая к созданию семьи, без опыта в отношениях.',
    interestsText: 'Любит походы в горы и вкусно поесть. Увлекается сноубордом',
    traits: [
      { icon: 'smile', label: 'Милая' },
      { icon: 'thumbsUp', label: 'Самодостаточная' },
      { icon: 'graduation', label: 'Образованная' },
      { icon: 'heart', label: 'Без опыта отношений' },
      { icon: 'leaf', label: 'Спокойная' },
    ],
    interests: [
      { icon: 'mountain', label: 'Поход' },
      { icon: 'bowl', label: 'Вкусная еда' },
      { icon: 'snowflake', label: 'Сноуборд' },
    ],
    facts: [
      {
        pattern: /сноуборд|катает|лыж|горнолыж/iu,
        answer: 'Валерия занимается сноубордом с *раннего* детства: раньше её бабушка и дедушка жили вблизи гор, и она часто навещала их.',
      },
      {
        pattern: /поход|горы|гор[ауе]|палатк|природ/iu,
        answer: 'В походы она ходит пару раз в год, чаще всего на *Урал*. Говорит, что лучший отдых — это вечер у костра без связи.',
      },
      {
        pattern: /ед[аыу]|готов|кухн|ресторан|кафе|поесть/iu,
        answer: 'Валерия любит *грузинскую* кухню и сама неплохо готовит хинкали. В новом городе первым делом ищет местное кафе.',
      },
      {
        pattern: /работ|професс|учил|образован|универ/iu,
        answer: 'Она окончила *КФУ* по специальности «прикладная математика» и сейчас работает аналитиком в IT-компании.',
      },
      {
        pattern: /семь|дет[иейя]|брак|отношен|серьёзн|серьезн/iu,
        answer: 'Валерия настроена *серьёзно*: она хочет семью и не торопит события. Опыта долгих отношений у неё пока не было.',
      },
      {
        pattern: /характер|какая она|спокойн|темперамент/iu,
        answer: 'Она *спокойная* и самодостаточная: умеет проводить время одна, но в компании быстро становится своей.',
      },
      {
        pattern: /книг|чита|фильм|кино|сериал|музык/iu,
        answer: 'Из фильмов Валерия любит тёплые *европейские* комедии, а в дороге слушает подкасты о путешествиях.',
      },
      {
        pattern: /животн|кошк|собак|питом/iu,
        answer: 'У Валерии есть *кошка* Луна. Собаку она тоже хочет, но пока не хватает времени.',
      },
    ],
  },
];

export function findCandidate(id: string | undefined) {
  return candidates.find((candidate) => candidate.id === id) ?? null;
}
