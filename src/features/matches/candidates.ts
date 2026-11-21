import type { ImageSourcePropType } from 'react-native';

/** Иконки тегов: линейные SVG из assets/icons/ui. */
export const traitIcons = {
  smile: require('../../../assets/icons/ui/smile.svg'),
  thumbsUp: require('../../../assets/icons/ui/thumbs-up.svg'),
  graduation: require('../../../assets/icons/ui/graduation.svg'),
  heart: require('../../../assets/icons/ui/heart.svg'),
  mountain: require('../../../assets/icons/ui/mountain.svg'),
  bowl: require('../../../assets/icons/ui/bowl.svg'),
  snowflake: require('../../../assets/icons/ui/snowflake.svg'),
  heartPlain: require('../../../assets/icons/ui/heart-plain.svg'),
  coffee: require('../../../assets/icons/ui/coffee.svg'),
  bike: require('../../../assets/icons/ui/bike.svg'),
  camera: require('../../../assets/icons/ui/camera.svg'),
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
  /** Имя в дательном падеже: «Напишите Артёму первым». */
  nameDative: string;
  sex: 'female' | 'male';
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

/** Слово по полу кандидата: byGender(candidate, 'ей', 'ему'). */
export function byGender(candidate: Pick<Candidate, 'sex'>, female: string, male: string) {
  return candidate.sex === 'female' ? female : male;
}

export function ageLabel(age: number) {
  const tens = age % 100;
  const ones = age % 10;
  if (tens >= 11 && tens <= 14) return `${age} лет`;
  if (ones === 1) return `${age} год`;
  if (ones >= 2 && ones <= 4) return `${age} года`;
  return `${age} лет`;
}

// Тестовые данные прототипа: фото Валерии из макета Figma, Артёма прислал заказчик; легенды выдуманы.
export const candidates: Candidate[] = [
  {
    id: 'valeria',
    name: 'Валерия',
    nameGenitive: 'Валерии',
    nameDative: 'Валерии',
    sex: 'female',
    age: 28,
    city: 'Казань',
    avatar: require('../../../assets/candidates/valeria-avatar.jpg'),
    photos: [
      require('../../../assets/candidates/valeria-1.jpg'),
      require('../../../assets/candidates/valeria-2.jpg'),
      require('../../../assets/candidates/valeria-3.jpg'),
    ],
    about: 'Спокойная, самодостаточная готовая к созданию семьи, без опыта в отношениях.',
    interestsText: 'Любит походы в горы и вкусно поесть. Увлекается сноубордом',
    traits: [
      { icon: 'smile', label: 'Милая' },
      { icon: 'thumbsUp', label: 'Самодостаточная' },
      { icon: 'graduation', label: 'Образованная' },
      { icon: 'heart', label: 'Без опыта отношений' },
      { icon: 'smile', label: 'Спокойная' },
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
  {
    id: 'artem',
    name: 'Артём',
    nameGenitive: 'Артёма',
    nameDative: 'Артёму',
    sex: 'male',
    age: 31,
    city: 'Санкт-Петербург',
    avatar: require('../../../assets/candidates/artem-avatar.jpg'),
    photos: [
      require('../../../assets/candidates/artem-1.jpg'),
      require('../../../assets/candidates/artem-2.jpg'),
      require('../../../assets/candidates/artem-3.jpg'),
    ],
    about: 'Открытый и весёлый, целеустремлённый. Хочет семью и детей, без вредных привычек.',
    interestsText: 'Знает лучшие кофейни Петербурга и сам варит кофе. По выходным катается на велосипеде и снимает город на плёнку',
    traits: [
      { icon: 'smile', label: 'Общительный' },
      { icon: 'thumbsUp', label: 'Целеустремлённый' },
      { icon: 'graduation', label: 'Образованный' },
      { icon: 'heartPlain', label: 'Хочет семью' },
    ],
    interests: [
      { icon: 'coffee', label: 'Кофе' },
      { icon: 'bike', label: 'Велосипед' },
      { icon: 'camera', label: 'Плёночное фото' },
    ],
    facts: [
      {
        pattern: /коф[еэ]|кофейн|бариста|капучино|латте|эспрессо/iu,
        answer: 'Кофе — его *главная* страсть. Дома у Артёма рожковая кофемашина, а по субботам он обходит новые кофейни на Петроградке.',
      },
      {
        pattern: /велосипед|вело|катает|спорт|трениров|бег/iu,
        answer: 'По выходным он катается на *шоссейном* велосипеде: летом доезжает до Финского залива. Зимой ходит в зал.',
      },
      {
        pattern: /фото|плён|плен|камер|снима/iu,
        answer: 'Артём снимает город на *плёночный* Зенит, который достался от деда, и сам проявляет плёнку.',
      },
      {
        pattern: /работ|професс|учил|образован|универ/iu,
        answer: 'Он окончил *СПбГАСУ* и работает архитектором: проектирует жилые дома и восстанавливает старые фасады.',
      },
      {
        pattern: /семь|дет[иейя]|брак|отношен|серьёзн|серьезн/iu,
        answer: 'Артём настроен *серьёзно*: хочет семью и двоих детей. Последние отношения закончились два года назад, расстались по-дружески.',
      },
      {
        pattern: /характер|какой он|общит|темперамент|весёл|весел/iu,
        answer: 'Он *открытый* и с юмором: легко заводит разговор, но умеет и слушать. Друзья говорят, что с ним спокойно.',
      },
      {
        pattern: /кур|пь[её]т|алкогол|привыч/iu,
        answer: 'Не курит и почти не пьёт, разве что бокал *вина* за ужином. Говорит, что кофе ему хватает.',
      },
      {
        pattern: /книг|чита|фильм|кино|сериал|музык/iu,
        answer: 'Любит *джаз* и старое кино. Из книг сейчас читает Довлатова — перечитывает уже третий раз.',
      },
      {
        pattern: /животн|кошк|собак|питом/iu,
        answer: 'У Артёма есть пёс *Бублик*, корги. Он ездит с ним в корзине велосипеда на короткие прогулки.',
      },
      {
        pattern: /путешеств|поездк|отпуск|страны|отдых/iu,
        answer: 'Любит путешествовать *на поезде*: в прошлом году проехал от Петербурга до Байкала.',
      },
    ],
  },
];

export function findCandidate(id: string | undefined) {
  return candidates.find((candidate) => candidate.id === id) ?? null;
}
