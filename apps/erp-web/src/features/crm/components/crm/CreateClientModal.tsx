import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useDisableScroll } from '../../hooks/useDisableScroll';
import { leadCrmService } from '../../services/leadsCrmV2';
import { ProductType, LeadStage } from '../../services/api';
import type { CreateLeadDto, Lead, LeadFile, UpdateLeadDto } from '../../services/api';
import { resolveDuplicateLeadForUser } from '../../utils/leadDuplicateHelper';
import { addLeadHistoryEntryDebounced, flushLeadHistory } from '../../utils/leadHistoryDebounce';
import { PhoneInput } from '../common/PhoneInput';
import { useI18n } from '@/i18n';
import { 
  FileText, 
  Image as ImageIcon, 
  File, 
  Music, 
  Video, 
  Archive, 
  FileSpreadsheet
} from 'lucide-react';

interface CreateClientModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit?: (clientName: string) => void;
  onLeadCreated?: () => void;
  lead?: Lead | null; // Для режима редактирования
  onLeadUpdated?: (updatedLead: Lead) => void; // Колбэк после обновления лида с обновленными данными
  initialStage?: LeadStage; // Начальная стадия для нового клиента
  initialProductType?: 'RP' | 'Net' | 'Owner' | 'Agent'; // Начальный продукт при создании нового лида
}

const countriesList = [
  { code: 'RU', name: 'Россия', flag: '🇷🇺' },
  { code: 'KZ', name: 'Казахстан', flag: '🇰🇿' },
  { code: 'UA', name: 'Украина', flag: '🇺🇦' },
  { code: 'BY', name: 'Беларусь', flag: '🇧🇾' },
  { code: 'TR', name: 'Турция', flag: '🇹🇷' },
  { code: 'AE', name: 'ОАЭ', flag: '🇦🇪' },
  { code: 'GE', name: 'Грузия', flag: '🇬🇪' },
  { code: 'US', name: 'США', flag: '🇺🇸' },
  { code: 'CA', name: 'Канада', flag: '🇨🇦' },
  { code: 'DE', name: 'Германия', flag: '🇩🇪' },
  { code: 'ES', name: 'Испания', flag: '🇪🇸' },
  { code: 'IT', name: 'Италия', flag: '🇮🇹' },
  { code: 'FR', name: 'Франция', flag: '🇫🇷' },
  { code: 'GB', name: 'Великобритания', flag: '🇬🇧' },
  { code: 'CN', name: 'Китай', flag: '🇨🇳' },
  { code: 'IN', name: 'Индия', flag: '🇮🇳' },
  { code: 'IL', name: 'Израиль', flag: '🇮🇱' },
  { code: 'JP', name: 'Япония', flag: '🇯🇵' },
  { code: 'KR', name: 'Южная Корея', flag: '🇰🇷' },
  { code: 'AU', name: 'Австралия', flag: '🇦🇺' },
  { code: 'BR', name: 'Бразилия', flag: '🇧🇷' },
  { code: 'MX', name: 'Мексика', flag: '🇲🇽' },
  { code: 'NL', name: 'Нидерланды', flag: '🇳🇱' },
  { code: 'BE', name: 'Бельгия', flag: '🇧🇪' },
  { code: 'CH', name: 'Швейцария', flag: '🇨🇭' },
  { code: 'SE', name: 'Швеция', flag: '🇸🇪' },
  { code: 'NO', name: 'Норвегия', flag: '🇳🇴' },
  { code: 'DK', name: 'Дания', flag: '🇩🇰' },
  { code: 'FI', name: 'Финляндия', flag: '🇫🇮' },
  { code: 'PL', name: 'Польша', flag: '🇵🇱' },
  { code: 'CZ', name: 'Чехия', flag: '🇨🇿' },
  { code: 'HU', name: 'Венгрия', flag: '🇭🇺' },
  { code: 'RO', name: 'Румыния', flag: '🇷🇴' },
  { code: 'PT', name: 'Португалия', flag: '🇵🇹' },
  { code: 'GR', name: 'Греция', flag: '🇬🇷' },
  { code: 'IE', name: 'Ирландия', flag: '🇮🇪' },
  { code: 'AM', name: 'Армения', flag: '🇦🇲' },
  { code: 'AZ', name: 'Азербайджан', flag: '🇦🇿' },
  { code: 'UZ', name: 'Узбекистан', flag: '🇺🇿' },
  { code: 'KG', name: 'Кыргызстан', flag: '🇰🇬' },
  { code: 'TJ', name: 'Таджикистан', flag: '🇹🇯' },
  { code: 'TM', name: 'Туркменистан', flag: '🇹🇲' },
  { code: 'EG', name: 'Египет', flag: '🇪🇬' },
  { code: 'ZA', name: 'ЮАР', flag: '🇿🇦' },
  { code: 'SG', name: 'Сингапур', flag: '🇸🇬' },
  { code: 'MY', name: 'Малайзия', flag: '🇲🇾' },
  { code: 'TH', name: 'Таиланд', flag: '🇹🇭' },
  { code: 'VN', name: 'Вьетнам', flag: '🇻🇳' },
  { code: 'ID', name: 'Индонезия', flag: '🇮🇩' },
  { code: 'PH', name: 'Филиппины', flag: '🇵🇭' },
];

const decodePotentiallyLatin1String = (value?: string): string | undefined => {
  if (!value) return value;
  const hasMultibyte = [...value].some((char) => char.charCodeAt(0) > 255);
  if (hasMultibyte) return value;
  if (typeof TextDecoder === 'undefined') return value;
  try {
    const bytes = Uint8Array.from(value, (char) => char.charCodeAt(0));
    const decoded = new TextDecoder('utf-8').decode(bytes);
    return decoded || value;
  } catch {
    return value;
  }
};

const normalizeLeadFiles = (files: LeadFile[]): LeadFile[] =>
  files.map((file) => ({
    ...file,
    originalName: decodePotentiallyLatin1String(file.originalName) || file.originalName,
  }));

const CreateClientModal: React.FC<CreateClientModalProps> = ({ isOpen, onClose, onLeadCreated, lead, onLeadUpdated, initialStage, initialProductType }) => {
  useDisableScroll(isOpen);
  const { t } = useI18n();
  const [clientName, setClientName] = useState('');
  const [clientFirstName, setClientFirstName] = useState('');
  const [clientLastName, setClientLastName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientTelegram, setClientTelegram] = useState('');
  const [selectedCountry, setSelectedCountry] = useState<{ code: string; name: string; flag?: string } | null>(null);
  const [clientBudget, setClientBudget] = useState('');
  const [clientDescription, setClientDescription] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<'RP' | 'Net' | 'Owner' | 'Agent'>('RP');
  const [selectedDeal, setSelectedDeal] = useState<string>('Покупка');
  const [selectedObject, setSelectedObject] = useState<string>('Квартира');
  const [selectedCurrency, setSelectedCurrency] = useState<string>('USD');
  const [selectedCity, setSelectedCity] = useState<string>('');
  const [citySearchQuery, setCitySearchQuery] = useState<string>('');
  const [isCityDropdownOpen, setIsCityDropdownOpen] = useState(false);
  const [countrySearchQuery, setCountrySearchQuery] = useState<string>('');
  const [isCountryDropdownOpen, setIsCountryDropdownOpen] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [existingFiles, setExistingFiles] = useState<LeadFile[]>([]);
  const [deletedFiles, setDeletedFiles] = useState<string[]>([]); // Имена файлов для удаления
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const [isDealDropdownOpen, setIsDealDropdownOpen] = useState(false);
  const [isObjectDropdownOpen, setIsObjectDropdownOpen] = useState(false);
  const [isCurrencyDropdownOpen, setIsCurrencyDropdownOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showConfirmClose, setShowConfirmClose] = useState(false);
  const [autoProductHint, setAutoProductHint] = useState<string | null>(null);
  
  // Сохраняем начальные значения для отслеживания изменений
  const initialValuesRef = useRef<{
    name: string;
    phone: string;
    email: string;
    budget: string;
    description: string;
    product: 'RP' | 'Net' | 'Owner' | 'Agent';
    deal: string;
    object: string;
    currency: string;
    city: string;
    filesCount: number;
  } | null>(null);
  
  const dealDropdownRef = useRef<HTMLDivElement>(null);
  const objectDropdownRef = useRef<HTMLDivElement>(null);
  const countryDropdownRef = useRef<HTMLDivElement>(null);
  const currencyDropdownRef = useRef<HTMLDivElement>(null);
  const cityDropdownRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Refs для управления скроллом и свайпом
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const touchStartElement = useRef<HTMLElement | null>(null);
  const modalContainerRef = useRef<HTMLDivElement | null>(null);

  const dealOptions = ['Покупка', 'Продажа', 'Аренда', 'Сдача в аренду'];
  const objectOptions = ['Квартира', 'Дом', 'Земельный участок', 'Коммерческая недвижимость'];
  const currencyOptions = ['USD', 'EUR', 'RUB', 'KZT'];
  
  // Список популярных городов мира с русскими названиями
  const cityOptions = [
    // Россия
    'Москва', 'Санкт-Петербург', 'Новосибирск', 'Екатеринбург', 'Казань', 'Нижний Новгород',
    'Челябинск', 'Самара', 'Омск', 'Ростов-на-Дону', 'Уфа', 'Красноярск', 'Воронеж', 'Пермь',
    'Волгоград', 'Краснодар', 'Саратов', 'Тюмень', 'Тольятти', 'Ижевск', 'Барнаул', 'Ульяновск',
    'Иркутск', 'Хабаровск', 'Ярославль', 'Владивосток', 'Махачкала', 'Томск', 'Оренбург', 'Кемерово',
    'Новокузнецк', 'Рязань', 'Астрахань', 'Набережные Челны', 'Пенза', 'Липецк', 'Киров', 'Чебоксары',
    'Калининград', 'Тула', 'Курск', 'Сочи', 'Ставрополь', 'Улан-Удэ', 'Магнитогорск', 'Тверь',
    'Иваново', 'Брянск', 'Белгород', 'Сургут', 'Владимир', 'Нижний Тагил', 'Архангельск', 'Чита',
    'Калуга', 'Смоленск', 'Волжский', 'Курган', 'Орёл', 'Саранск', 'Череповец', 'Вологда',
    'Владикавказ', 'Мурманск', 'Якутск', 'Грозный', 'Стерлитамак', 'Кострома', 'Петрозаводск',
    'Таганрог', 'Нижневартовск', 'Йошкар-Ола', 'Новороссийск', 'Химки', 'Сыктывкар', 'Нальчик',
    'Шахты', 'Нижнекамск', 'Дзержинск', 'Братск', 'Орск', 'Ангарск', 'Благовещенск', 'Старый Оскол',
    'Великий Новгород', 'Энгельс', 'Королёв', 'Псков', 'Бийск', 'Прокопьевск', 'Балашиха',
    'Хасавюрт', 'Армавир', 'Мытищи', 'Южно-Сахалинск', 'Люберцы', 'Рыбинск', 'Красногорск',
    'Норильск', 'Серпухов', 'Новочеркасск', 'Златоуст', 'Электросталь', 'Альметьевск', 'Салават',
    'Миасс', 'Керчь', 'Находка', 'Копейск', 'Рубцовск', 'Борисоглебск', 'Новошахтинск',
    // Казахстан
    'Алматы', 'Астана', 'Шымкент', 'Актау', 'Актобе', 'Атырау', 'Караганда', 'Костанай',
    'Кызылорда', 'Павлодар', 'Петропавловск', 'Семей', 'Тараз', 'Уральск', 'Усть-Каменогорск', 'Экибастуз',
    // Украина
    'Киев', 'Харьков', 'Одесса', 'Днепр', 'Донецк', 'Запорожье', 'Львов', 'Кривой Рог',
    'Николаев', 'Мариуполь', 'Луганск', 'Винница', 'Макеевка', 'Севастополь', 'Симферополь', 'Херсон',
    'Полтава', 'Чернигов', 'Черкассы', 'Сумы', 'Хмельницкий', 'Житомир', 'Кировоград', 'Ровно',
    // Беларусь
    'Минск', 'Гомель', 'Могилёв', 'Витебск', 'Гродно', 'Брест', 'Бобруйск', 'Барановичи',
    'Борисов', 'Пинск', 'Орша', 'Мозырь', 'Солигорск', 'Новополоцк', 'Лида', 'Молодечно',
    // Европа
    'Париж', 'Лондон', 'Берлин', 'Мадрид', 'Рим', 'Амстердам', 'Вена', 'Прага',
    'Будапешт', 'Варшава', 'Стокгольм', 'Копенгаген', 'Осло', 'Хельсинки', 'Дублин', 'Лиссабон',
    'Брюссель', 'Афины', 'София', 'Бухарест', 'Белград', 'Загреб', 'Любляна', 'Братислава',
    'Милан', 'Барселона', 'Мюнхен', 'Франкфурт', 'Гамбург', 'Кёльн', 'Штутгарт', 'Дюссельдорф',
    'Эдинбург', 'Ливерпуль', 'Манчестер', 'Бирмингем', 'Глазго', 'Лион', 'Марсель', 'Тулуза',
    'Ницца', 'Бордо', 'Лилль', 'Нант', 'Страсбург', 'Ренн', 'Реймс', 'Сент-Этьен',
    'Турин', 'Неаполь', 'Палермо', 'Генуя', 'Болонья', 'Флоренция', 'Бари', 'Катания',
    'Венеция', 'Верона', 'Пиза', 'Парма', 'Модена', 'Реджо-нель-Эмилия', 'Равенна', 'Феррара',
    // США и Канада
    'Нью-Йорк', 'Лос-Анджелес', 'Чикаго', 'Хьюстон', 'Финикс', 'Филадельфия', 'Сан-Антонио', 'Сан-Диего',
    'Даллас', 'Сан-Хосе', 'Остин', 'Джексонвилл', 'Сан-Франциско', 'Индианаполис', 'Колумбус', 'Форт-Уэрт',
    'Шарлотт', 'Сиэтл', 'Денвер', 'Вашингтон', 'Мемфис', 'Бостон', 'Эль-Пасо', 'Детройт',
    'Нашвилл', 'Портленд', 'Оклахома-Сити', 'Лас-Вегас', 'Балтимор', 'Луисвилл', 'Милуоки', 'Альбукерке',
    'Туксон', 'Фресно', 'Сакраменто', 'Канзас-Сити', 'Меса', 'Атланта', 'Омаха', 'Колорадо-Спрингс',
    'Роли', 'Вирджиния-Бич', 'Майами', 'Окленд', 'Миннеаполис', 'Талса', 'Кливленд', 'Уичито',
    'Арлингтон', 'Новый Орлеан', 'Гонолулу', 'Торонто', 'Монреаль', 'Ванкувер', 'Калгари', 'Эдмонтон',
    'Оттава', 'Виннипег', 'Квебек', 'Гамильтон', 'Китченер', 'Виктория', 'Галифакс', 'Ошава',
    // Азия
    'Токио', 'Йокогама', 'Осака', 'Нагоя', 'Саппоро', 'Фукуока', 'Киото', 'Кобе',
    'Сэндай', 'Хиросима', 'Китакюсю', 'Пекин', 'Шанхай', 'Гуанчжоу', 'Шэньчжэнь', 'Чэнду',
    'Ханчжоу', 'Ухань', 'Сиань', 'Нанкин', 'Тяньцзинь', 'Сучжоу', 'Дунгуань', 'Чунцин',
    'Шэньян', 'Далиан', 'Циндао', 'Чжэнчжоу', 'Чанша', 'Фошань', 'Харбин', 'Цзинань',
    'Хэфэй', 'Фучжоу', 'Сямэнь', 'Наньчан', 'Шицзячжуан', 'Тайюань', 'Куньмин', 'Чанчунь',
    'Чжуншань', 'Урумчи', 'Гуйян', 'Хух-Хото', 'Сеул', 'Пусан', 'Инчхон', 'Тэгу',
    'Тэджон', 'Кванджу', 'Ульсан', 'Сувон', 'Чханвон', 'Соннам', 'Коян', 'Пучхон',
    'Ансан', 'Йонъин', 'Чхонджу', 'Чонджу', 'Аньян', 'Асан', 'Иксан', 'Пхёнтхэк',
    // Австралия и Новая Зеландия
    'Сидней', 'Мельбурн', 'Брисбен', 'Перт', 'Аделаида', 'Голд-Кост', 'Ньюкасл', 'Канберра',
    'Саншайн-Кост', 'Вуллонгонг', 'Хобарт', 'Джилонг', 'Таунсвилл', 'Кэрнс', 'Тувумба', 'Балларат',
    'Бендиго', 'Олбери', 'Ла-Троб', 'Маккай', 'Рокхэмптон', 'Банбери', 'Бандаберг', 'Кофс-Харбор',
    'Окленд', 'Веллингтон', 'Крайстчерч', 'Гамильтон', 'Тауранга', 'Данидин', 'Палмерстон-Норт', 'Нейпир',
    // Ближний Восток
    'Дубай', 'Абу-Даби', 'Шарджа', 'Аль-Айн', 'Аджман', 'Рас-эль-Хайма', 'Фуджейра', 'Умм-эль-Кайвайн',
    'Эр-Рияд', 'Джидда', 'Мекка', 'Медина', 'Даммам', 'Таиф', 'Бурайда', 'Хаиль',
    'Табук', 'Эль-Хубар', 'Эль-Джубайль', 'Эль-Хуфуф', 'Каир', 'Александрия', 'Гиза', 'Шубра-эль-Хейма',
    'Порт-Саид', 'Суэц', 'Луксор', 'Асуан', 'Исмаилия', 'Эль-Мансура', 'Танта', 'Загазиг',
    'Хургада', 'Шарм-эль-Шейх', 'Марса-Алам', 'Тегеран', 'Мешхед', 'Исфахан', 'Кередж', 'Тебриз',
    'Шираз', 'Ахваз', 'Кум', 'Керманшах', 'Урмия', 'Рашт', 'Захедан', 'Хамадан',
    // Турция и Кавказ
    'Стамбул', 'Анкара', 'Измир', 'Бурса', 'Анталья', 'Адана', 'Газиантеп', 'Конья',
    'Антакия', 'Кайсери', 'Мерсин', 'Эскишехир', 'Диярбакыр', 'Самсун', 'Денизли', 'Шанлыурфа',
    'Трабзон', 'Орду', 'Бодрум', 'Мармарис', 'Фетхие', 'Каш', 'Каппадокия', 'Памуккале',
    'Баку', 'Гянджа', 'Сумгаит', 'Мингечаур', 'Ленкорань', 'Шеки', 'Нахичевань', 'Ереван',
    'Гюмри', 'Ванадзор', 'Вагаршапат', 'Абовян', 'Капан', 'Алаверди', 'Тбилиси', 'Батуми',
    'Кутаиси', 'Рустави', 'Гори', 'Поти', 'Зугдиди', 'Гурджаани', 'Телави', 'Ахалцихе'
  ];

  const filteredCityOptions = cityOptions.filter(city =>
    city.toLowerCase().includes(citySearchQuery.toLowerCase())
  );

  // Маппинг ProductType в продукт для UI
  const mapProductTypeToProduct = (productType: ProductType): 'RP' | 'Net' | 'Owner' | 'Agent' => {
    switch (productType) {
      case ProductType.SALES: return 'RP';
      case ProductType.NETWORK: return 'Net';
      case ProductType.OWNER: return 'Owner';
      case ProductType.AGENT: return 'Agent';
      default: return 'RP';
    }
  };

  // Загрузка файлов лида в режиме редактирования
  const loadLeadFiles = async () => {
    if (!lead?._id) {
      setExistingFiles([]);
      return;
    }
    
    // Всегда загружаем файлы через API для получения актуального списка
    try {
      const filesResponse = await leadCrmService.getLeadFiles(lead._id);
      if (filesResponse.success && filesResponse.data) {
        setExistingFiles(normalizeLeadFiles(filesResponse.data.files || []));
      } else {
        // Если API не вернул файлы, пытаемся использовать файлы из объекта lead
        if (lead.files && lead.files.length > 0) {
          setExistingFiles(normalizeLeadFiles(lead.files));
        } else {
          setExistingFiles([]);
        }
      }
    } catch (error) {
      console.warn('Failed to load lead files from API, using lead.files if available:', error);
      // Если API не поддерживается или произошла ошибка, используем файлы из объекта lead
      if (lead.files && lead.files.length > 0) {
        setExistingFiles(normalizeLeadFiles(lead.files));
      } else {
        setExistingFiles([]);
      }
    }
  };

  // Предзаполнение формы при открытии в режиме редактирования
  useEffect(() => {
    if (isOpen && lead) {
      // Загружаем полный объект лида с бэкенда, чтобы гарантировать наличие всех полей, включая budgetValue и budgetCurrency
      const loadFullLead = async () => {
        try {
          const response = await leadCrmService.getLead(lead._id);
          if (response.success && response.data) {
            const fullLead = response.data;
            
            // Режим редактирования - предзаполняем поля из полного объекта лида
            const product = mapProductTypeToProduct(fullLead.productType);
            setSelectedProduct(product);
            
            // Для NETWORK, RP, Owner, Agent разбиваем name: отчество остаётся в поле Имя (с первым словом), фамилия — последний токен
            if ((product === 'Net' || product === 'RP' || product === 'Owner' || product === 'Agent') && fullLead.name) {
              const nameParts = fullLead.name.trim().split(/\s+/).filter(Boolean);
              if (nameParts.length > 1) {
                const last = nameParts[nameParts.length - 1];
                const first = nameParts.slice(0, -1).join(' ');
                setClientFirstName(first);
                setClientLastName(last);
              } else {
                setClientFirstName(nameParts[0] || '');
                setClientLastName('');
              }
              setClientName(''); // Не используем для NETWORK и RP
            } else {
              setClientName(fullLead.name || '');
              setClientFirstName('');
              setClientLastName('');
            }
            
            setClientPhone(fullLead.phone || '');
            setClientEmail(fullLead.email || '');
            setClientBudget(fullLead.budgetValue ? formatBudget(fullLead.budgetValue.toString()) : '');
            setClientDescription(fullLead.notes || '');
            setSelectedCity(fullLead.city || '');
            if ((fullLead as any).country) {
              const country = (fullLead as any).country;
              setSelectedCountry(country);
              setCountrySearchQuery(country.name || '');
            } else {
              setCountrySearchQuery('');
            }
            if ((fullLead as any).telegram) {
              setClientTelegram((fullLead as any).telegram || '');
            } else {
              setClientTelegram('');
            }
            setSelectedCurrency(fullLead.budgetCurrency || 'USD');

            // Парсим source для получения deal и object
            if (fullLead.source) {
              const parts = fullLead.source.split(' - ');
              if (parts.length === 2) {
                setSelectedDeal(parts[0].trim() || 'Покупка');
                setSelectedObject(parts[1].trim() || 'Квартира');
              }
            }

            // Загружаем файлы лида
            if (fullLead.files) {
              setExistingFiles(fullLead.files);
            } else {
              loadLeadFiles();
            }
            setDeletedFiles([]);
            setSelectedFiles([]);

            // Сохраняем начальные значения (включая количество файлов)
            initialValuesRef.current = {
              name: fullLead.name || '',
              phone: fullLead.phone || '',
              email: fullLead.email || '',
              budget: fullLead.budgetValue ? fullLead.budgetValue.toString() : '',
              description: fullLead.notes || '',
              product: mapProductTypeToProduct(fullLead.productType),
              deal: fullLead.source ? (fullLead.source.split(' - ')[0]?.trim() || 'Покупка') : 'Покупка',
              object: fullLead.source ? (fullLead.source.split(' - ')[1]?.trim() || 'Квартира') : 'Квартира',
              currency: fullLead.budgetCurrency || 'USD',
              city: fullLead.city || '',
              filesCount: fullLead.files?.length || 0,
            };
          } else {
            // Если не удалось загрузить, используем данные из переданного объекта lead
            const product = mapProductTypeToProduct(lead.productType);
            setSelectedProduct(product);
            
            // Для NETWORK и RP разбиваем name на firstName и lastName
            if ((product === 'Net' || product === 'RP') && lead.name) {
              const nameParts = lead.name.trim().split(/\s+/);
              setClientFirstName(nameParts[0] || '');
              setClientLastName(nameParts.slice(1).join(' ') || '');
              setClientName(''); // Не используем для NETWORK и RP
            } else {
              setClientName(lead.name || '');
              setClientFirstName('');
              setClientLastName('');
            }
            
            setClientPhone(lead.phone || '');
            setClientEmail(lead.email || '');
            setClientBudget(lead.budgetValue ? formatBudget(lead.budgetValue.toString()) : '');
            setClientDescription(lead.notes || '');
            setSelectedCity(lead.city || '');
            if ((lead as any).country) {
              const country = (lead as any).country;
              setSelectedCountry(country);
              setCountrySearchQuery(country.name || '');
            } else {
              setCountrySearchQuery('');
            }
            if ((lead as any).telegram) {
              setClientTelegram((lead as any).telegram || '');
            } else {
              setClientTelegram('');
            }
            setSelectedCurrency(lead.budgetCurrency || 'USD');

            if (lead.source) {
              const parts = lead.source.split(' - ');
              if (parts.length === 2) {
                setSelectedDeal(parts[0].trim() || 'Покупка');
                setSelectedObject(parts[1].trim() || 'Квартира');
              }
            }

            loadLeadFiles();
            setDeletedFiles([]);
            setSelectedFiles([]);

            initialValuesRef.current = {
              name: lead.name || '',
              phone: lead.phone || '',
              email: lead.email || '',
              budget: lead.budgetValue ? lead.budgetValue.toString() : '',
              description: lead.notes || '',
              product: mapProductTypeToProduct(lead.productType),
              deal: lead.source ? (lead.source.split(' - ')[0]?.trim() || 'Покупка') : 'Покупка',
              object: lead.source ? (lead.source.split(' - ')[1]?.trim() || 'Квартира') : 'Квартира',
              currency: lead.budgetCurrency || 'USD',
              city: lead.city || '',
              filesCount: lead.files?.length || 0,
            };
          }
        } catch (error) {
          console.error('Ошибка при загрузке полного объекта лида:', error);
          // В случае ошибки используем данные из переданного объекта lead
          const product = mapProductTypeToProduct(lead.productType);
          setSelectedProduct(product);
          
          // Для NETWORK и RP разбиваем name: отчество остаётся в поле Имя, фамилия — последний токен
          if ((product === 'Net' || product === 'RP') && lead.name) {
            const nameParts = lead.name.trim().split(/\s+/).filter(Boolean);
            if (nameParts.length > 1) {
              const last = nameParts[nameParts.length - 1];
              const first = nameParts.slice(0, -1).join(' ');
              setClientFirstName(first);
              setClientLastName(last);
            } else {
              setClientFirstName(nameParts[0] || '');
              setClientLastName('');
            }
            setClientName(''); // Не используем для NETWORK и RP
          } else {
            setClientName(lead.name || '');
            setClientFirstName('');
            setClientLastName('');
          }
          
          setClientPhone(lead.phone || '');
          setClientEmail(lead.email || '');
          setClientBudget(lead.budgetValue ? formatBudget(lead.budgetValue.toString()) : '');
          setClientDescription(lead.notes || '');
          setSelectedCity(lead.city || '');
          setSelectedCurrency(lead.budgetCurrency || 'USD');
          
          // Загружаем telegram и country
          if ((lead as any).country) {
            const country = (lead as any).country;
            setSelectedCountry(country);
            setCountrySearchQuery(country.name || '');
          } else {
            setSelectedCountry(null);
            setCountrySearchQuery('');
          }
          if ((lead as any).telegram) {
            setClientTelegram((lead as any).telegram || '');
          } else {
            setClientTelegram('');
          }

          if (lead.source) {
            const parts = lead.source.split(' - ');
            if (parts.length === 2) {
              setSelectedDeal(parts[0].trim() || 'Покупка');
              setSelectedObject(parts[1].trim() || 'Квартира');
            }
          }

          loadLeadFiles();
          setDeletedFiles([]);
          setSelectedFiles([]);

          initialValuesRef.current = {
            name: lead.name || '',
            phone: lead.phone || '',
            email: lead.email || '',
            budget: lead.budgetValue ? lead.budgetValue.toString() : '',
            description: lead.notes || '',
            product: mapProductTypeToProduct(lead.productType),
            deal: lead.source ? (lead.source.split(' - ')[0]?.trim() || 'Покупка') : 'Покупка',
            object: lead.source ? (lead.source.split(' - ')[1]?.trim() || 'Квартира') : 'Квартира',
            currency: lead.budgetCurrency || 'USD',
            city: lead.city || '',
            filesCount: lead.files?.length || 0,
          };
        }
      };

      loadFullLead();
    } else if (isOpen && !lead) {
      // Режим создания - сбрасываем значения
      setClientName('');
      setClientFirstName('');
      setClientLastName('');
      setClientPhone('');
      setClientEmail('');
      setClientBudget('');
      setClientDescription('');
      setSelectedProduct(initialProductType || 'RP');
      setSelectedDeal('Покупка');
      setSelectedObject('Квартира');
      setSelectedCurrency('USD');
      setSelectedCity('');
      setSelectedCountry(null);
      setCountrySearchQuery('');
      setClientTelegram('');
      setCitySearchQuery('');
      setSelectedFiles([]);
      setExistingFiles([]);
      setDeletedFiles([]);
      setAutoProductHint(null);
      initialValuesRef.current = null;
    }
  }, [isOpen, lead, initialProductType]);

  // Автовыбор продукта по initialStage (когда модалка открыта из конкретной воронки)
  // Срабатывает только при создании нового лида (!lead)
  useEffect(() => {
    if (!isOpen || !initialStage || lead) return;
    const stageStr = String(initialStage);
    let targetProduct: 'RP' | 'Net' | 'Owner' | 'Agent' = 'RP';
    let hint = '«Продажи»';
    if (stageStr.includes('network_')) {
      targetProduct = 'Net';
      hint = '«Сеть»';
    } else if (stageStr.includes('owner_')) {
      targetProduct = 'Owner';
      hint = '«Собственник»';
    } else if (stageStr.includes('agent_')) {
      targetProduct = 'Agent';
      hint = '«Посредник»';
    }
    setSelectedProduct(targetProduct);
    setAutoProductHint(`Выбрано автоматически, так как вы находитесь в воронке ${hint}.`);
  }, [initialStage, isOpen, lead]);

  // Проверка наличия изменений
  const hasChanges = (): boolean => {
    if (!lead || !initialValuesRef.current) return false; // В режиме создания всегда false

    const useFirstLastFormat = selectedProduct === 'Net' || selectedProduct === 'RP' || selectedProduct === 'Owner' || selectedProduct === 'Agent';
    const currentName = useFirstLastFormat 
      ? `${clientFirstName.trim()} ${clientLastName.trim()}`.trim()
      : clientName.trim();

    const current = {
      name: currentName,
      phone: clientPhone.trim(),
      email: clientEmail.trim(),
      budget: clientBudget.trim(),
      description: clientDescription.trim(),
      product: selectedProduct,
      deal: selectedDeal,
      object: selectedObject,
      currency: selectedCurrency,
      city: selectedCity,
      filesCount: existingFiles.filter(f => !deletedFiles.includes(f.filename)).length + selectedFiles.length,
    };

    const initial = initialValuesRef.current;

    return (
      current.name !== initial.name ||
      current.phone !== initial.phone ||
      current.email !== initial.email ||
      current.budget !== initial.budget ||
      current.description !== initial.description ||
      current.product !== initial.product ||
      current.deal !== initial.deal ||
      current.object !== initial.object ||
      current.city !== initial.city ||
      current.filesCount !== initial.filesCount
    );
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dealDropdownRef.current && !dealDropdownRef.current.contains(event.target as Node)) {
        setIsDealDropdownOpen(false);
      }
      if (objectDropdownRef.current && !objectDropdownRef.current.contains(event.target as Node)) {
        setIsObjectDropdownOpen(false);
      }
      if (currencyDropdownRef.current && !currencyDropdownRef.current.contains(event.target as Node)) {
        setIsCurrencyDropdownOpen(false);
      }
      if (countryDropdownRef.current && !countryDropdownRef.current.contains(event.target as Node)) {
        setIsCountryDropdownOpen(false);
      }
      if (cityDropdownRef.current && !cityDropdownRef.current.contains(event.target as Node)) {
        setIsCityDropdownOpen(false);
      }
    };

    if (isDealDropdownOpen || isObjectDropdownOpen || isCurrencyDropdownOpen || isCityDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isDealDropdownOpen, isObjectDropdownOpen, isCurrencyDropdownOpen, isCityDropdownOpen]);

  // Обработка движения касания для предотвращения конфликтов со скроллом
  useEffect(() => {
    if (!isOpen) return;

    const container = modalContainerRef.current;
    if (!container) return;

    const handleTouchMoveNative = (e: TouchEvent) => {
      if (touchStartX.current === null || touchStartY.current === null) {
        return;
      }

      const touchCurrentX = e.touches[0].clientX;
      const touchCurrentY = e.touches[0].clientY;
      const diffX = touchCurrentX - touchStartX.current;
      const diffY = touchCurrentY - touchStartY.current;

      if (Math.abs(diffX) < 5 && Math.abs(diffY) < 5) {
        return;
      }

      if (touchStartElement.current) {
        const scrollableContainer = touchStartElement.current.closest('.overflow-x-auto, .overflow-y-auto');
        if (scrollableContainer) {
          const container = scrollableContainer as HTMLElement;
          const scrollWidth = container.scrollWidth;
          const clientWidth = container.clientWidth;
          const scrollTop = container.scrollTop;
          const scrollHeight = container.scrollHeight;
          const clientHeight = container.clientHeight;

          const hasHorizontalScroll = scrollWidth > clientWidth;
          const hasVerticalScroll = scrollHeight > clientHeight;
          const isAtTopEdge = scrollTop <= 1;
          const isAtBottomEdge = scrollTop + clientHeight >= scrollHeight - 1;

          if (hasHorizontalScroll) {
            return;
          }

          if (hasVerticalScroll) {
            if (Math.abs(diffY) > Math.abs(diffX)) {
              return;
            }

            if (!isAtTopEdge && !isAtBottomEdge) {
              return;
            }
          }
        }
      }

      if (Math.abs(diffY) > Math.abs(diffX)) {
        return;
      }
    };

    container.addEventListener('touchmove', handleTouchMoveNative, { passive: false });

    return () => {
      container.removeEventListener('touchmove', handleTouchMoveNative);
    };
  }, [isOpen]);

  // Функция сброса формы
  const resetForm = () => {
    setClientName('');
    setClientFirstName('');
    setClientLastName('');
    setClientPhone('');
    setClientEmail('');
    setClientTelegram('');
    setSelectedCountry(null);
    setCountrySearchQuery('');
    setClientBudget('');
    setClientDescription('');
    setSelectedProduct('RP');
    setSelectedDeal('Покупка');
    setSelectedObject('Квартира');
    setSelectedCurrency('USD');
    setSelectedCity('');
    setIsCountryDropdownOpen(false);
    setSelectedFiles([]);
    setExistingFiles([]);
    setDeletedFiles([]);
    setIsDealDropdownOpen(false);
    setIsObjectDropdownOpen(false);
    setIsCurrencyDropdownOpen(false);
    setIsCityDropdownOpen(false);
    setSubmitError(null);
    setIsSubmitting(false);
    setIsUploadingFiles(false);
    setShowConfirmClose(false);
    setAutoProductHint(null);
    initialValuesRef.current = null;
  };

  const handleClose = useCallback(() => {
    // Если есть изменения в режиме редактирования, показываем подтверждение
    if (lead && hasChanges()) {
      setShowConfirmClose(true);
      return;
    }
    resetForm();
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead, onClose]);

  // Обработчик начала касания для управления скроллом
  const handleTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement;
    touchStartElement.current = target;

    const scrollableContainer = target.closest('.overflow-x-auto, .overflow-y-auto');
    if (scrollableContainer) {
      const container = scrollableContainer as HTMLElement;
      const scrollWidth = container.scrollWidth;
      const clientWidth = container.clientWidth;
      const scrollTop = container.scrollTop;
      const scrollHeight = container.scrollHeight;
      const clientHeight = container.clientHeight;

      const hasHorizontalScroll = scrollWidth > clientWidth;
      const hasVerticalScroll = scrollHeight > clientHeight;
      const isAtTopEdge = scrollTop <= 1;
      const isAtBottomEdge = scrollTop + clientHeight >= scrollHeight - 1;

      if (hasHorizontalScroll) {
        touchStartX.current = e.touches[0].clientX;
        touchStartY.current = e.touches[0].clientY;
        return;
      }

      if (hasVerticalScroll && !isAtTopEdge && !isAtBottomEdge) {
        touchStartX.current = null;
        touchStartY.current = null;
        return;
      }
    }

    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  // Обработчик окончания касания для закрытия модалки при свайпе вниз
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) {
      touchStartX.current = null;
      touchStartY.current = null;
      touchStartElement.current = null;
      return;
    }

    if (touchStartElement.current) {
      const scrollableContainer = touchStartElement.current.closest('.overflow-x-auto, .overflow-y-auto');
      if (scrollableContainer) {
        const container = scrollableContainer as HTMLElement;
        const scrollLeft = container.scrollLeft;
        const scrollWidth = container.scrollWidth;
        const clientWidth = container.clientWidth;
        const scrollTop = container.scrollTop;
        const scrollHeight = container.scrollHeight;
        const clientHeight = container.clientHeight;

        const hasHorizontalScroll = scrollWidth > clientWidth;
        const isAtLeftEdge = scrollLeft <= 1;
        const isAtRightEdge = scrollLeft + clientWidth >= scrollWidth - 1;

        const hasVerticalScroll = scrollHeight > clientHeight;
        const isAtTopEdge = scrollTop <= 1;
        const isAtBottomEdge = scrollTop + clientHeight >= scrollHeight - 1;

        if (hasHorizontalScroll && !isAtLeftEdge && !isAtRightEdge) {
          touchStartX.current = null;
          touchStartY.current = null;
          touchStartElement.current = null;
          return;
        }

        if (hasVerticalScroll && !isAtTopEdge && !isAtBottomEdge) {
          touchStartX.current = null;
          touchStartY.current = null;
          touchStartElement.current = null;
          return;
        }
      }
    }

    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;
    const diffX = touchEndX - touchStartX.current;
    const diffY = touchEndY - touchStartY.current;

    const minSwipeDistance = 50;

    if (Math.abs(diffY) > Math.abs(diffX) && diffY > minSwipeDistance) {
      let canClose = true;

      if (touchStartElement.current && modalContainerRef.current) {
        let currentElement: HTMLElement | null = touchStartElement.current;

        while (currentElement && currentElement !== modalContainerRef.current) {
          const style = window.getComputedStyle(currentElement);
          const isScrollable = style.overflowY === 'auto' || style.overflowY === 'scroll' ||
                              style.overflow === 'auto' || style.overflow === 'scroll' ||
                              currentElement.classList.contains('overflow-y-auto') ||
                              currentElement.classList.contains('overflow-x-auto');

          if (isScrollable) {
            const scrollTop = currentElement.scrollTop;
            const scrollHeight = currentElement.scrollHeight;
            const clientHeight = currentElement.clientHeight;
            const hasVerticalScroll = scrollHeight > clientHeight;
            const isAtTopEdge = scrollTop <= 1;

            if (hasVerticalScroll && !isAtTopEdge) {
              canClose = false;
              break;
            }
          }

          currentElement = currentElement.parentElement;
        }

        if (canClose) {
          const modalContent = modalContainerRef.current;
          if (modalContent) {
            const scrollTop = modalContent.scrollTop;
            const scrollHeight = modalContent.scrollHeight;
            const clientHeight = modalContent.clientHeight;
            const hasVerticalScroll = scrollHeight > clientHeight;
            const isAtTopEdge = scrollTop <= 1;

            if (hasVerticalScroll && !isAtTopEdge) {
              canClose = false;
            }
          }
        }
      } else if (modalContainerRef.current) {
        const modalContent = modalContainerRef.current;
        const scrollTop = modalContent.scrollTop;
        const scrollHeight = modalContent.scrollHeight;
        const clientHeight = modalContent.clientHeight;
        const hasVerticalScroll = scrollHeight > clientHeight;
        const isAtTopEdge = scrollTop <= 1;

        if (hasVerticalScroll && !isAtTopEdge) {
          canClose = false;
        }
      }

      if (canClose) {
        handleClose();
      }

      touchStartX.current = null;
      touchStartY.current = null;
      touchStartElement.current = null;
      return;
    }

    touchStartX.current = null;
    touchStartY.current = null;
    touchStartElement.current = null;
  }, [handleClose]);

  // Остальные функции-обработчики
  const handleConfirmClose = async () => {
    // Сохраняем незаписанные изменения истории перед закрытием
    if (lead?._id) {
      await flushLeadHistory(lead._id);
    }
    resetForm();
    setShowConfirmClose(false);
    onClose();
  };

  const handleCancelClose = () => {
    setShowConfirmClose(false);
  };

  // Обработчик клика вне модалки - останавливаем распространение, чтобы не закрывать родительскую модалку
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Останавливаем распространение события, чтобы оно не дошло до родительской модалки
    e.stopPropagation();
    handleClose();
  };

  if (!isOpen) return null;

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    const filesArray = Array.from(files);
    
    // Константы валидации
    const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
    const MAX_FILES_PER_UPLOAD = 10;
    const MAX_FILES_PER_LEAD = 10;
    
    // Проверка количества файлов в запросе
    if (filesArray.length > MAX_FILES_PER_UPLOAD) {
      alert(`Можно загрузить максимум ${MAX_FILES_PER_UPLOAD} файлов за раз`);
      return;
    }

    const tooLarge = filesArray.find((f) => f.size > MAX_FILE_SIZE);
    if (tooLarge) {
      alert(`Файл «${tooLarge.name}» превышает лимит 100 МБ`);
      return;
    }

    // Проверка текущего количества файлов у лида (только в режиме редактирования)
    if (lead?._id) {
      const currentFilesCount = existingFiles.filter(f => !deletedFiles.includes(f.filename)).length; // Учитываем удаленные файлы
      if (currentFilesCount + filesArray.length > MAX_FILES_PER_LEAD) {
        alert(`Максимум ${MAX_FILES_PER_LEAD} файлов на лид. Текущее количество: ${currentFilesCount}, пытаетесь добавить: ${filesArray.length}`);
        return;
      }
    }

    setSelectedFiles(filesArray);
  };

  const handleRemoveFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const getFileIcon = (mimeType: string, size: number = 20) => {
    const iconProps = { size, className: 'flex-shrink-0' };
    
    if (mimeType.includes('pdf')) {
      return <FileText {...iconProps} className="text-red-600" />;
    } else if (mimeType.includes('excel') || mimeType.includes('spreadsheet') || mimeType.includes('xls') || mimeType.includes('xlsx')) {
      return <FileSpreadsheet {...iconProps} className="text-green-600" />;
    } else if (mimeType.includes('word') || mimeType.includes('document') || mimeType.includes('doc') || mimeType.includes('docx')) {
      return <FileText {...iconProps} className="text-[#b4ccc3]" />;
    } else if (mimeType.includes('image')) {
      return <ImageIcon {...iconProps} className="text-yellow-500" />;
    } else if (mimeType.includes('audio') || mimeType.includes('mp3') || mimeType.includes('wav') || mimeType.includes('ogg')) {
      return <Music {...iconProps} className="text-purple-600" />;
    } else if (mimeType.includes('video') || mimeType.includes('mp4') || mimeType.includes('avi') || mimeType.includes('mov')) {
      return <Video {...iconProps} className="text-pink-600" />;
    } else if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('archive') || mimeType.includes('7z')) {
      return <Archive {...iconProps} className="text-orange-600" />;
    }
    return <File {...iconProps} className="text-gray-600" />;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  // Форматирование бюджета с разделителями (8.888.888.888)
  const formatBudget = (value: string): string => {
    // Убираем все кроме цифр
    const numbers = value.replace(/\D/g, '');
    if (!numbers) return '';
    
    // Форматируем с разделителями каждые 3 цифры справа налево
    return numbers.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  };

  // Парсинг бюджета из отформатированной строки
  const parseBudget = (value: string): number => {
    const numbers = value.replace(/\D/g, '');
    return numbers ? parseFloat(numbers) : 0;
  };

  // Маппинг продукта в ProductType
  const mapProductToProductType = (product: 'RP' | 'Net' | 'Owner' | 'Agent'): ProductType => {
    switch (product) {
      case 'RP': return ProductType.SALES;
      case 'Net': return ProductType.NETWORK;
      case 'Owner': return ProductType.OWNER;
      case 'Agent': return ProductType.AGENT;
      default: return ProductType.SALES;
    }
  };

  // Нормализация телефона - сохраняем формат пользователя, только убираем лишние пробелы
  const normalizePhone = (phone: string): string => {
    // Убираем только лишние пробелы в начале и конце, сохраняем все остальные символы
    let normalized = phone.trim();
    // Убираем множественные пробелы, заменяя их на один
    normalized = normalized.replace(/\s+/g, ' ');
    return normalized;
  };

  // Обработчик создания или обновления лида
  // Функция для очистки только поля "Информация о клиенте" (notes)
  const handleClearAllInfo = async () => {
    if (!lead) {
      // В режиме создания просто очищаем поле описания
      setClientDescription('');
      return;
    }

    // Подтверждение перед очисткой
    const confirmed = window.confirm('Вы уверены, что хотите удалить всю информацию о клиенте (описание)? Это действие нельзя отменить.');
    if (!confirmed) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      // Очищаем только поле notes (описание/информация о клиенте)
      const updateData: UpdateLeadDto = {
        name: lead.name,
        phone: lead.phone,
        productType: lead.productType,
        notes: '', // Очищаем только описание
      };

      const response = await leadCrmService.updateLead(lead._id, updateData);

      if (response.success && response.data) {
        // Сохраняем старое значение для истории
        const oldNotes = (lead.notes || '').trim();

        // Добавляем запись в историю (с задержкой 30 секунд), если было что удалить
        if (oldNotes) {
          const removedText = oldNotes.length > 100 ? oldNotes.substring(0, 100) + '...' : oldNotes;
          addLeadHistoryEntryDebounced(lead._id, {
            message: `Удалено из описания: ${removedText}`,
          });
        }

        // Обновляем только поле описания в форме
        setClientDescription('');

        // Обновляем initialValuesRef для корректной работы hasChanges
        if (response.data) {
          initialValuesRef.current = {
            name: response.data.name || '',
            phone: response.data.phone || '',
            email: response.data.email || '',
            city: response.data.city || '',
            budget: response.data.budgetValue ? response.data.budgetValue.toString() : '',
            description: '', // Очищено
            product: mapProductTypeToProduct(response.data.productType),
            deal: response.data.source ? (response.data.source.split(' - ')[0]?.trim() || 'Покупка') : 'Покупка',
            object: response.data.source ? (response.data.source.split(' - ')[1]?.trim() || 'Квартира') : 'Квартира',
            currency: response.data.budgetCurrency || 'USD',
            filesCount: response.data.files?.length || 0,
          };
        }

        if (onLeadUpdated && response.data) {
          onLeadUpdated(response.data);
        }

        // Показываем сообщение об успехе
        alert('Информация о клиенте успешно удалена');
      } else {
        setSubmitError('Не удалось очистить информацию о клиенте');
      }
    } catch (error: any) {
      console.error('Failed to clear lead info:', error);
      setSubmitError('Произошла ошибка при очистке информации');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveLead = async () => {
    // В режиме создания всегда используем firstName и lastName
    // В режиме редактирования для NETWORK и RP используем firstName и lastName, для остальных - clientName
    const useFirstLastFormat = selectedProduct === 'Net' || selectedProduct === 'RP' || selectedProduct === 'Owner' || selectedProduct === 'Agent';
    const nameForSave = !lead || useFirstLastFormat
      ? `${clientFirstName.trim()} ${clientLastName.trim()}`.trim()
      : clientName.trim();
    
    if (!lead && (!clientFirstName.trim() || !clientLastName.trim() || !clientPhone.trim())) {
      setSubmitError('Имя, фамилия и телефон обязательны для заполнения');
      return;
    }
    
    if (lead && ((useFirstLastFormat && (!clientFirstName.trim() || !clientLastName.trim())) || (!useFirstLastFormat && !clientName.trim()) || !clientPhone.trim())) {
      setSubmitError(useFirstLastFormat ? 'Имя, фамилия и телефон обязательны для заполнения' : 'Имя и телефон обязательны для заполнения');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    const normalizedPhone = normalizePhone(clientPhone);
    const normalizedEmail = clientEmail.trim();
    const duplicatePayload = lead
      ? null
      : {
          phone: normalizedPhone,
          email: normalizedEmail || undefined,
        };

    const currentUserId = localStorage.getItem('userId') || '690ca643abbceba815ba7090';
    
    try {
      if (lead) {
        // Режим редактирования - обновляем лида
        const updateData: UpdateLeadDto = {
          name: useFirstLastFormat ? nameForSave : clientName.trim(),
          phone: normalizePhone(clientPhone),
          productType: mapProductToProductType(selectedProduct),
        };

        if (clientEmail.trim()) {
          updateData.email = clientEmail.trim();
        } else {
          updateData.email = undefined; // Явно удаляем email, если он был очищен
        }

        if (selectedCity) {
          updateData.city = selectedCity;
        }

        // Позволяем очистить notes - передаем undefined если пустое, иначе обрезанную строку
        if (clientDescription.trim()) {
        updateData.notes = clientDescription.trim();
        } else {
          updateData.notes = undefined; // Удаляем описание, если поле пустое
        }

        // Telegram и Country (новые поля с 24.12.2025)
        // Всегда передаем telegram (даже пустую строку для удаления)
          (updateData as any).telegram = clientTelegram.trim();

        if (selectedCountry) {
          (updateData as any).country = selectedCountry;
        } else {
          (updateData as any).country = null;
        }

        // Для NETWORK не обновляем бюджет, сделку, объект, валюту
        const isNetworkProduct = selectedProduct === 'Net';
        if (!isNetworkProduct) {
          if (clientBudget.trim()) {
            const budgetValue = parseBudget(clientBudget);
            if (!isNaN(budgetValue) && budgetValue > 0) {
              updateData.budgetValue = budgetValue;
            }
          }

          if (selectedDeal && selectedObject) {
            updateData.source = `${selectedDeal} - ${selectedObject}`;
          }

          if (selectedCurrency) {
            updateData.budgetCurrency = selectedCurrency as 'USD' | 'EUR' | 'RUB' | 'KZT';
          }
        }

        // Проверяем, изменился ли productType
        const oldProductType = lead.productType;
        const newProductType = mapProductToProductType(selectedProduct);
        const productTypeChanged = oldProductType !== newProductType;

        // Если productType изменился, автоматически устанавливаем этап "Новый лид"
        if (productTypeChanged) {
          const getDefaultNewLeadStage = (product: 'RP' | 'Net' | 'Owner' | 'Agent'): LeadStage => {
            switch (product) {
              case 'RP': return LeadStage.NEEDS_ANALYSIS;
              case 'Net': return LeadStage.NETWORK_NEW_LEAD;
              case 'Owner': return LeadStage.OWNER_NEW_OWNER;
              case 'Agent': return LeadStage.AGENT_NEW_AGENT;
              default: return LeadStage.NEEDS_ANALYSIS;
            }
          };
          updateData.stage = getDefaultNewLeadStage(selectedProduct);
        }

        // Сохраняем старые значения для истории (используем нормализованные значения для корректного сравнения)
        const oldValues = {
          name: (lead.name || '').trim(),
          phone: normalizePhone(lead.phone || ''),
          email: (lead.email || '').trim(),
          city: (lead.city || '').trim(),
          budgetValue: lead.budgetValue || 0,
          budgetCurrency: lead.budgetCurrency || 'USD',
          source: (lead.source || '').trim(),
          notes: (lead.notes || '').trim(),
          productType: lead.productType,
        };

        // Нормализуем новые значения для сравнения
        const newValues = {
          name: useFirstLastFormat ? nameForSave : clientName.trim(),
          phone: normalizePhone(clientPhone),
          email: clientEmail.trim(),
          city: selectedCity.trim(),
          budgetValue: isNetworkProduct ? (lead.budgetValue || 0) : (clientBudget.trim() ? parseBudget(clientBudget) : 0),
          budgetCurrency: isNetworkProduct ? (lead.budgetCurrency || 'USD') : (selectedCurrency || 'USD'),
          source: isNetworkProduct ? (lead.source || '').trim() : ((selectedDeal && selectedObject) ? `${selectedDeal} - ${selectedObject}`.trim() : ''),
          notes: clientDescription.trim(),
          productType: newProductType,
        };

        const response = await leadCrmService.updateLead(lead._id, updateData);

        if (response.success && response.data) {
          // Если productType изменился и мы установили новый этап, убеждаемся, что этап действительно обновлен
          let updatedLead = response.data;
          if (productTypeChanged && updateData.stage) {
            // Проверяем, что этап был установлен корректно
            if (updatedLead.stage !== updateData.stage) {
              // Если этап не был установлен через updateLead, устанавливаем его отдельно
              try {
                const stageResponse = await leadCrmService.updateLeadStage(lead._id, { stage: updateData.stage });
                if (stageResponse.success && stageResponse.data) {
                  updatedLead = stageResponse.data;
                }
              } catch (error) {
                console.error('Failed to update lead stage after productType change:', error);
              }
            }
          }

          // Добавляем записи в историю только для действительно измененных полей
          // Сравниваем нормализованные старые значения с нормализованными новыми значениями
          const historyEntries: Array<{ message: string }> = [];
          
          // ФИО - сравниваем нормализованные значения
          if (oldValues.name !== newValues.name) {
            historyEntries.push({
              message: `Изменено ФИО: ${oldValues.name || '(не указано)'} -> ${newValues.name || '(не указано)'}`,
            });
          }
          
          // Телефон - сравниваем нормализованные значения
          if (oldValues.phone !== newValues.phone) {
            historyEntries.push({
              message: `Изменен номер телефона: ${oldValues.phone || '(не указано)'} -> ${newValues.phone || '(не указано)'}`,
            });
          }
          
          // Email - сравниваем нормализованные значения
          if (oldValues.email !== newValues.email) {
            historyEntries.push({
              message: `Изменена почта: ${oldValues.email || '(не указано)'} -> ${newValues.email || '(не указано)'}`,
            });
          }
          
          // Город - сравниваем нормализованные значения
          if (oldValues.city !== newValues.city) {
            historyEntries.push({
              message: `Изменен город: ${oldValues.city || '(не указано)'} -> ${newValues.city || '(не указано)'}`,
            });
          }
          
          // Бюджет - сравниваем числовые значения и валюту
          if (oldValues.budgetValue !== newValues.budgetValue || oldValues.budgetCurrency !== newValues.budgetCurrency) {
            const oldBudget = oldValues.budgetValue ? `${oldValues.budgetValue} ${oldValues.budgetCurrency}` : '(не указано)';
            const newBudget = newValues.budgetValue ? `${newValues.budgetValue} ${newValues.budgetCurrency}` : '(не указано)';
            historyEntries.push({
              message: `Изменен бюджет: ${oldBudget} -> ${newBudget}`,
            });
          }
          
          // Тип сделки и тип объекта - сравниваем нормализованные значения
          if (oldValues.source !== newValues.source) {
            historyEntries.push({
              message: `Изменен тип сделки/объекта: ${oldValues.source || '(не указано)'} -> ${newValues.source || '(не указано)'}`,
            });
          }
          
          // Описание (notes) - определяем что было добавлено и что удалено
          if (oldValues.notes !== newValues.notes) {
            const oldNotes = oldValues.notes;
            const newNotes = newValues.notes;
            
            if (!oldNotes && newNotes) {
              // Только добавление (описание было пустым, теперь заполнено)
              const addedText = newNotes.length > 100 ? newNotes.substring(0, 100) + '...' : newNotes;
              historyEntries.push({
                message: `Добавлено в описание: ${addedText}`,
              });
            } else if (oldNotes && !newNotes) {
              // Только удаление (описание было заполнено, теперь пустое)
              const removedText = oldNotes.length > 100 ? oldNotes.substring(0, 100) + '...' : oldNotes;
              historyEntries.push({
                message: `Удалено из описания: ${removedText}`,
              });
            } else {
              // Изменение (частичное или полное)
              // Разбиваем на строки для сравнения
              const oldLines = oldNotes.split('\n').map(line => line.trim()).filter(line => line.length > 0);
              const newLines = newNotes.split('\n').map(line => line.trim()).filter(line => line.length > 0);
              
              // Находим строки, которые были удалены (есть в старом, но нет в новом)
              const removedLines = oldLines.filter(line => !newLines.includes(line));
              // Находим строки, которые были добавлены (есть в новом, но нет в старом)
              const addedLines = newLines.filter(line => !oldLines.includes(line));
              
              if (removedLines.length > 0 && addedLines.length > 0) {
                // И удаление, и добавление
                const removedText = removedLines.length > 3 
                  ? removedLines.slice(0, 3).join('; ') + ` и еще ${removedLines.length - 3} строк`
                  : removedLines.join('; ');
                const addedText = addedLines.length > 3 
                  ? addedLines.slice(0, 3).join('; ') + ` и еще ${addedLines.length - 3} строк`
                  : addedLines.join('; ');
                historyEntries.push({
                  message: `Изменено описание. Удалено: ${removedText}. Добавлено: ${addedText}`,
                });
              } else if (removedLines.length > 0) {
                // Только удаление
                const removedText = removedLines.length > 3 
                  ? removedLines.slice(0, 3).join('; ') + ` и еще ${removedLines.length - 3} строк`
                  : removedLines.join('; ');
                historyEntries.push({
                  message: `Удалено из описания: ${removedText}`,
                });
              } else if (addedLines.length > 0) {
                // Только добавление
                const addedText = addedLines.length > 3 
                  ? addedLines.slice(0, 3).join('; ') + ` и еще ${addedLines.length - 3} строк`
                  : addedLines.join('; ');
                historyEntries.push({
                  message: `Добавлено в описание: ${addedText}`,
                });
              } else {
                // Если текст был изменен, но не удалось определить построчно (например, изменена часть строки)
                // Показываем что было изменено, но ограничиваем длину
                const oldText = oldNotes.length > 50 ? oldNotes.substring(0, 50) + '...' : oldNotes;
                const newText = newNotes.length > 50 ? newNotes.substring(0, 50) + '...' : newNotes;
                historyEntries.push({
                  message: `Изменено описание: ${oldText || '(не указано)'} -> ${newText || '(не указано)'}`,
                });
              }
            }
          }
          
          // ProductType - если изменился, добавляем запись в историю
          if (productTypeChanged) {
            const getProductLabel = (pt: ProductType) => {
              switch (pt) {
                case ProductType.SALES: return 'Продажи';
                case ProductType.NETWORK: return 'Сеть';
                case ProductType.OWNER: return 'Собственник';
                case ProductType.AGENT: return 'Посредник';
                default: return 'Продажи';
              }
            };
            const oldProductLabel = getProductLabel(oldProductType);
            const newProductLabel = getProductLabel(newProductType);
            historyEntries.push({
              message: `Изменен тип продукта: ${oldProductLabel} -> ${newProductLabel}. Этап автоматически установлен на "Новый лид"`,
            });
          }
          
          // Добавляем все записи в историю (с задержкой 30 секунд)
          for (const entry of historyEntries) {
            addLeadHistoryEntryDebounced(lead._id, entry);
          }
          
          // Удаляем файлы, если есть удаленные
          if (deletedFiles.length > 0) {
            try {
              const deletePromises = deletedFiles.map(filename => {
                return leadCrmService.deleteLeadFileByName(lead._id, filename).catch(error => {
                  console.error(`[CreateClientModal] Failed to delete file ${filename}:`, error);
                  return { success: false, message: error.message };
                });
              });
              
              await Promise.all(deletePromises);

              // После удаления файлов перезагружаем список файлов
              await loadLeadFiles();
            } catch (error: any) {
              console.error('[CreateClientModal] Failed to delete files:', error);
              throw new Error(error.response?.data?.message || 'Ошибка при удалении файлов');
            }
          } else {
          }

          // Загружаем новые файлы, если есть
          if (selectedFiles.length > 0) {
            try {
              setIsUploadingFiles(true);
              
              // Проверка текущего количества файлов у лида
              const MAX_FILES_PER_LEAD = 10;
              const currentFilesCount = existingFiles.filter(f => !deletedFiles.includes(f.filename)).length; // Учитываем удаленные файлы
              if (currentFilesCount + selectedFiles.length > MAX_FILES_PER_LEAD) {
                throw new Error(`Максимум ${MAX_FILES_PER_LEAD} файлов на лид. Текущее количество: ${currentFilesCount}, пытаетесь добавить: ${selectedFiles.length}`);
              }
              
              await leadCrmService.uploadLeadFiles(lead._id, selectedFiles);
            } catch (error: any) {
              // Мягкая обработка ошибки - API может не поддерживать загрузку файлов лидов
              if (error.response?.status === 404) {
                console.warn('File upload API endpoint not available for leads. Files were not uploaded.');
                // Не показываем ошибку пользователю, если API не поддерживает загрузку файлов
              } else {
                console.error('Failed to upload files:', error);
                const errorMessage = error.message || error.response?.data?.message || 'Ошибка при загрузке файлов';
                alert(errorMessage);
              }
            } finally {
              setIsUploadingFiles(false);
            }
          }

          if (onLeadUpdated) {
            onLeadUpdated(updatedLead);
          }
          // Перезагружаем файлы после обновления лида
          if (lead?._id) {
            await loadLeadFiles();
          }
          resetForm();
          onClose();
        } else {
          // Обработка ошибки 409 Conflict (дубликат лида)
          if (response.message && response.message.includes('уже существует')) {
            setSubmitError('Лид с таким номером телефона или email уже существует. Пожалуйста, проверьте данные или измените телефон/email.');
          } else {
            setSubmitError(response.message || 'Ошибка при обновлении клиента');
          }
        }
      } else {
        // Режим создания - создаем нового лида

        const leadData: CreateLeadDto = {
          name: useFirstLastFormat ? nameForSave : clientName.trim(),
          phone: normalizedPhone,
          productType: mapProductToProductType(selectedProduct),
          assignedTo: currentUserId,
        };

        if (normalizedEmail) {
          leadData.email = normalizedEmail;
        }

        // Telegram и Country (новые поля с 24.12.2025)
        if (clientTelegram.trim()) {
          (leadData as any).telegram = clientTelegram.trim();
        }

        if (selectedCountry) {
          (leadData as any).country = selectedCountry;
        }

        // В режиме создания добавляем описание
        leadData.source = 'Ручное добавление';
        if (clientDescription.trim()) {
          leadData.notes = clientDescription.trim();
        }

        const response = await leadCrmService.createLead(leadData);

        if (response.success && response.data) {
          // Определяем этап "Новый лид" для выбранного продукта
          const getDefaultNewLeadStage = (product: 'RP' | 'Net' | 'Owner' | 'Agent'): LeadStage => {
            switch (product) {
              case 'RP': return LeadStage.NEEDS_ANALYSIS;
              case 'Net': return LeadStage.NETWORK_NEW_LEAD;
              case 'Owner': return LeadStage.OWNER_NEW_OWNER;
              case 'Agent': return LeadStage.AGENT_NEW_AGENT;
              default: return LeadStage.NEEDS_ANALYSIS;
            }
          };

          // Устанавливаем этап: либо указанный initialStage, либо "Новый лид" по умолчанию
          const stageToSet = initialStage || getDefaultNewLeadStage(selectedProduct);
          
          if (response.data._id) {
            try {
              await leadCrmService.updateLeadStage(response.data._id, { stage: stageToSet });
              // Перезагружаем лида, чтобы получить обновленную стадию
              const updatedLeadResponse = await leadCrmService.getLead(response.data._id);
              if (updatedLeadResponse.success && updatedLeadResponse.data) {
                response.data = updatedLeadResponse.data;
              }
            } catch (error: any) {
              console.error('Failed to set initial stage for new lead:', error);
              // Не показываем ошибку пользователю, так как клиент уже создан
            }
          }

          if (onLeadCreated) {
            onLeadCreated();
          }
          resetForm();
          onClose();
        } else {
          // Обработка ошибки 409 Conflict (дубликат лида)
          if (response.message && response.message.includes('уже существует')) {
            const duplicateResult = await resolveDuplicateLeadForUser(
              { phone: leadData.phone, email: leadData.email },
              currentUserId
            );
            if (duplicateResult.assignedToCurrentUser) {
              alert(duplicateResult.message || 'Лид существовал у другого пользователя и теперь назначен на вас.');
              if (onLeadCreated) {
                await onLeadCreated();
              }
              resetForm();
              onClose();
              return;
            }
            setSubmitError('Лид с таким номером телефона или email уже существует. Пожалуйста, проверьте данные или измените телефон/email.');
          } else {
            setSubmitError(response.message || 'Ошибка при создании клиента');
          }
        }
      }
    } catch (error: any) {
        console.error('Failed to save lead:', error);
        let errorMessage = error.response?.data?.message || `Ошибка при ${lead ? 'обновлении' : 'создании'} клиента. Попробуйте еще раз.`;
        if (errorMessage.includes('уже существует') || error.response?.status === 409) {
          if (!lead && duplicatePayload) {
            const duplicateResult = await resolveDuplicateLeadForUser(duplicatePayload, currentUserId);
            if (duplicateResult.assignedToCurrentUser) {
              alert(duplicateResult.message || 'Лид существовал у другого пользователя и теперь назначен на вас.');
              if (onLeadCreated) {
                await onLeadCreated();
              }
              resetForm();
              onClose();
              return;
            }
          }
          errorMessage = 'Лид с таким номером телефона или email уже существует. Пожалуйста, проверьте данные или измените телефон/email.';
        }
        setSubmitError(errorMessage);
      } finally {
        setIsSubmitting(false);
      }
  };

  return createPortal(
    <>
      <div className="modal-fade-in fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end md:items-center justify-center z-[60] pt-[15px] md:pt-4 pb-0 md:pb-4 px-0 md:px-4 transition-all duration-300 ease-out animate-in fade-in" onClick={handleBackdropClick}>
      <div 
        ref={modalContainerRef}
        className="relative flex flex-col bg-white rounded-t-[25px] md:rounded-[25px] shadow-2xl w-full md:w-[70.89%] h-auto md:max-h-[85vh] animate-in zoom-in-95 slide-in-from-bottom-4 duration-300" 
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div className="flex-1 flex flex-col items-center p-4 md:p-6 overflow-y-auto">
          <button onClick={handleClose} aria-label={t('crm.crm.createClientModal.закрыть')} className="absolute -top-8.5 -right-10 hidden md:block">
            <svg width="45" height="45" viewBox="0 0 45 45" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M33.75 11.25L11.25 33.75" stroke="white" strokeWidth="3" strokeLinecap="round"/>
              <path d="M11.25 11.25L33.75 33.75" stroke="white" strokeWidth="3" strokeLinecap="round"/>
            </svg>
          </button>
          <div className='w-full flex justify-center gap-2.5 items-center pt-2.5 pb-3 relative'>
            <button onClick={handleClose} aria-label={t('crm.crm.createClientModal.закрыть')} className="absolute left-0 top-1/2 -translate-y-1/2 hidden">
              <svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.5 7.5L7.5 22.5" stroke="#169600" strokeWidth="3" strokeLinecap="round"/>
                <path d="M7.5 7.5L22.5 22.5" stroke="#169600" strokeWidth="3" strokeLinecap="round"/>
              </svg>
            </button>
            <svg width="25" height="25" viewBox="0 0 25 25" fill="none" xmlns="http://www.w3.org/2000/svg">
              <g clipPath="url(#clip0_4812_43169)">
              <path d="M19.7107 1.92375H17.3342V0.976562C17.3342 0.437164 16.897 0 16.3576 0H8.675C8.1356 0 7.69844 0.437164 7.69844 0.976562V1.92375H5.32227C3.97606 1.92375 2.88086 3.01895 2.88086 4.36516V22.5586C2.88086 23.9048 3.97606 25 5.32227 25H19.7107C21.0569 25 22.1521 23.9048 22.1521 22.5586V4.36516C22.1521 3.01895 21.0567 1.92375 19.7107 1.92375ZM15.3811 1.95312V3.84769H9.65137C9.65137 3.19862 9.65137 2.66247 9.65137 1.95312H15.3811ZM20.199 22.5586C20.199 22.8279 19.9799 23.0469 19.7107 23.0469H5.32227C5.05295 23.0469 4.83398 22.8279 4.83398 22.5586V4.36516C4.83398 4.09603 5.05295 3.87688 5.32227 3.87688H7.69825V4.82426C7.69825 5.36366 8.1356 5.80082 8.67481 5.80082H16.3576C16.8968 5.80082 17.3342 5.36366 17.3342 4.82426V3.87688H19.7107C19.9799 3.87688 20.199 4.09603 20.199 4.36516V22.5586ZM17.0479 11.4023C17.4294 11.7838 17.4294 12.4022 17.0479 12.7834L11.916 17.9153C11.5347 18.2968 10.9163 18.2968 10.5349 17.9153L7.98454 15.365C7.60326 14.9837 7.60326 14.3654 7.98454 13.9839C8.36601 13.6026 8.98418 13.6026 9.36565 13.9839L11.2255 15.8438L15.6668 11.4025C16.0482 11.021 16.6664 11.021 17.0479 11.4023Z" fill="#169600"/>
              </g>
              <defs>
              <clipPath id="clip0_4812_43169">
              <rect width="25" height="25" fill="white"/>
              </clipPath>
              </defs>
            </svg>
            <span 
              className='text-dream-primary text-xl md:text-[28px]'
              style={{
                fontFamily: 'var(--font-sans)',
                fontWeight: 400,
                fontStyle: 'normal',
                lineHeight: '150%',
                letterSpacing: '-0.01em',
                leadingTrim: 'cap-height'
              } as React.CSSProperties & { leadingTrim?: string }}
            >
              {lead ? (selectedProduct === 'Net' ? 'Изменить информацию о реферале' : 'Изменить информацию о клиенте') : 'Добавить нового клиента'}
            </span>
          </div>
          <div className='w-full flex flex-col gap-3.5 overflow-y-auto'>
            <div className='w-full flex items-center gap-5.5 justify-center py-2.5 rounded-lg mt-4 mb-3' style={{ background: '#112d1c' }}>
              <span 
                className='text-black'
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontWeight: 400,
                  fontStyle: 'normal',
                  fontSize: '18px',
                  lineHeight: '150%',
                  letterSpacing: '-0.01em',
                  leadingTrim: 'cap-height'
                } as React.CSSProperties & { leadingTrim?: string }}
              >
                {t('crm.crm.createClientModal.продукт')}</span>
              <div className='flex items-center gap-4 py-1'>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="product"
                    value="RP"
                    checked={selectedProduct === 'RP'}
                    onChange={(e) => setSelectedProduct(e.target.value as 'RP' | 'Net' | 'Owner' | 'Agent')}
                    className="sr-only"
                  />
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all duration-200 ${
                    selectedProduct === 'RP'
                      ? 'border-dream-primary bg-white'
                      : 'border-gray-500'
                  }`}>
                    {selectedProduct === 'RP' && (
                      <div className="w-3 h-3 rounded-full bg-dream-primary" />
                    )}
                  </div>
                  <span 
                    className={selectedProduct === 'RP' ? 'text-dream-primary' : ''}
                    style={{
                      fontFamily: 'var(--font-sans)',
                      fontWeight: 400,
                      fontStyle: 'normal',
                      fontSize: '18px',
                      lineHeight: '100%',
                      letterSpacing: '0px',
                      leadingTrim: 'none'
                    } as React.CSSProperties & { leadingTrim?: string }}
                  >
                    {t('crm.crm.createClientModal.продажи')}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="product"
                    value="Net"
                    checked={selectedProduct === 'Net'}
                    onChange={(e) => setSelectedProduct(e.target.value as 'RP' | 'Net' | 'Owner' | 'Agent')}
                    className="sr-only"
                  />
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all duration-200 ${
                    selectedProduct === 'Net'
                      ? 'border-dream-primary bg-white'
                      : 'border-gray-500'
                  }`}>
                    {selectedProduct === 'Net' && (
                      <div className="w-3 h-3 rounded-full bg-dream-primary" />
                    )}
                  </div>
                  <span 
                    className={selectedProduct === 'Net' ? 'text-dream-primary' : ''}
                    style={{
                      fontFamily: 'var(--font-sans)',
                      fontWeight: 400,
                      fontStyle: 'normal',
                      fontSize: '18px',
                      lineHeight: '100%',
                      letterSpacing: '0px',
                      leadingTrim: 'none'
                    } as React.CSSProperties & { leadingTrim?: string }}
                  >
                    {t('crm.crm.createClientModal.сеть')}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="product"
                    value="Owner"
                    checked={selectedProduct === 'Owner'}
                    onChange={(e) => setSelectedProduct(e.target.value as 'RP' | 'Net' | 'Owner' | 'Agent')}
                    className="sr-only"
                  />
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all duration-200 ${
                    selectedProduct === 'Owner'
                      ? 'border-dream-primary bg-white'
                      : 'border-gray-500'
                  }`}>
                    {selectedProduct === 'Owner' && (
                      <div className="w-3 h-3 rounded-full bg-dream-primary" />
                    )}
                  </div>
                  <span 
                    className={selectedProduct === 'Owner' ? 'text-dream-primary' : ''}
                    style={{
                      fontFamily: 'var(--font-sans)',
                      fontWeight: 400,
                      fontStyle: 'normal',
                      fontSize: '18px',
                      lineHeight: '100%',
                      letterSpacing: '0px',
                      leadingTrim: 'none'
                    } as React.CSSProperties & { leadingTrim?: string }}
                  >
                    {t('crm.crm.createClientModal.собственник')}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="product"
                    value="Agent"
                    checked={selectedProduct === 'Agent'}
                    onChange={(e) => setSelectedProduct(e.target.value as 'RP' | 'Net' | 'Owner' | 'Agent')}
                    className="sr-only"
                  />
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all duration-200 ${
                    selectedProduct === 'Agent'
                      ? 'border-dream-primary bg-white'
                      : 'border-gray-500'
                  }`}>
                    {selectedProduct === 'Agent' && (
                      <div className="w-3 h-3 rounded-full bg-dream-primary" />
                    )}
                  </div>
                  <span 
                    className={selectedProduct === 'Agent' ? 'text-dream-primary' : ''}
                    style={{
                      fontFamily: 'var(--font-sans)',
                      fontWeight: 400,
                      fontStyle: 'normal',
                      fontSize: '18px',
                      lineHeight: '100%',
                      letterSpacing: '0px',
                      leadingTrim: 'none'
                    } as React.CSSProperties & { leadingTrim?: string }}
                  >
                    {t('crm.crm.createClientModal.посредник')}</span>
                </label>
              </div>
              {!lead && autoProductHint && (
                <p className="text-xs text-gray-500 mt-1 italic">
                  {autoProductHint}
                </p>
              )}
            </div>
            {/* Создание лида: два столбца - Имя/Телефон и Фамилия/Email */}
            {!lead && (
              <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Колонка 1: Имя и Телефон */}
                <div className="flex flex-col gap-4">
                  {/* Имя */}
                  <div className='flex flex-col gap-3.5'>
                    <span className='text-black' style={{ fontFamily: 'var(--font-sans)', fontWeight: 400, fontSize: '18px', lineHeight: '150%' }}>{t('createClientModal.firstName')}<span className="text-red-500">*</span>
                    </span>
                    <input
                      type="text"
                      maxLength={48}
                      value={clientFirstName}
                      onChange={(e) => setClientFirstName(e.target.value.slice(0, 48))}
                      placeholder={t('crm.crm.createClientModal.введите_имя')}
                      className={`w-full h-12.5 border-2 bg-dream-secondary rounded-full pl-5 py-2 focus:outline-none transition-colors ${
                        !clientFirstName.trim() && isSubmitting ? 'border-red-500 bg-red-50' : 'border-dream-primary/50'
                      }`}
                      style={{ fontFamily: 'var(--font-sans)', fontWeight: 400, fontSize: '14px', lineHeight: '100%' }}
                    />
                  </div>

                  {/* Телефон */}
                  <div className='flex flex-col gap-3.5'>
                    <span className='text-black' style={{ fontFamily: 'var(--font-sans)', fontWeight: 400, fontSize: '18px', lineHeight: '150%' }}>{t('createClientModal.phone')}<span className="text-red-500">*</span>
                    </span>
                    <input
                      type="text"
                      value={clientPhone}
                      onChange={(e) => setClientPhone(e.target.value)}
                      placeholder={t('crm.crm.createClientModal.введите_номер_телефо')}
                      className={`w-full h-12.5 border-2 bg-dream-secondary rounded-full pl-5 py-2 focus:outline-none transition-colors ${
                        !clientPhone.trim() && isSubmitting ? 'border-red-500 bg-red-50' : 'border-dream-primary/50'
                      }`}
                      style={{ fontFamily: 'var(--font-sans)', fontWeight: 400, fontSize: '14px', lineHeight: '100%' }}
                    />
                  </div>
                </div>

                {/* Колонка 2: Фамилия и Email */}
                <div className="flex flex-col gap-4">
                  {/* Фамилия */}
                  <div className='flex flex-col gap-3.5'>
                    <span className='text-black' style={{ fontFamily: 'var(--font-sans)', fontWeight: 400, fontSize: '18px', lineHeight: '150%' }}>{t('createClientModal.lastName')}<span className="text-red-500">*</span>
                    </span>
                    <input
                      type="text"
                      maxLength={48}
                      value={clientLastName}
                      onChange={(e) => setClientLastName(e.target.value.slice(0, 48))}
                      placeholder={t('createClientModal.lastNamePlaceholder')}
                      className={`w-full h-12.5 border-2 bg-dream-secondary rounded-full pl-5 py-2 focus:outline-none transition-colors ${
                        !clientLastName.trim() && isSubmitting ? 'border-red-500 bg-red-50' : 'border-dream-primary/50'
                      }`}
                      style={{ fontFamily: 'var(--font-sans)', fontWeight: 400, fontSize: '14px', lineHeight: '100%' }}
                    />
                  </div>

                  {/* Email */}
                  <div className='flex flex-col gap-3.5'>
                    <span className='text-black' style={{ fontFamily: 'var(--font-sans)', fontWeight: 400, fontSize: '18px', lineHeight: '150%' }}>
                      Email
                    </span>
                    <input
                      type="email"
                      value={clientEmail}
                      onChange={(e) => setClientEmail(e.target.value)}
                      placeholder={t('createClientModal.emailPlaceholder')}
                      className="w-full h-12.5 border-2 border-dream-primary/50 bg-dream-secondary rounded-full pl-5 py-2 focus:outline-none"
                      style={{ fontFamily: 'var(--font-sans)', fontWeight: 400, fontSize: '14px', lineHeight: '100%' }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* В режиме редактирования: два столбца с распределением полей */}
            {lead && (
              <>
                {(selectedProduct === 'Net' || selectedProduct === 'RP') && (
                  <div className='w-full grid grid-cols-1 md:grid-cols-2 gap-6'>
                    {/* Колонка 1: Имя, Телефон, Почта, Город, Объект (только для RP) */}
                    <div className='flex flex-col gap-3.5'>
                      {/* Имя */}
                      <div className='flex flex-col gap-3.5'>
                        <span 
                          className='text-black'
                          style={{
                            fontFamily: 'var(--font-sans)',
                            fontWeight: 400,
                            fontStyle: 'normal',
                            fontSize: '18px',
                            lineHeight: '150%',
                            letterSpacing: '-0.01em',
                            leadingTrim: 'none'
                          } as React.CSSProperties & { leadingTrim?: string }}
                        >{t('createClientModal.firstName')}<span className="text-red-500">*</span>
                        </span>
                        <input
                          type="text"
                          maxLength={48}
                          value={clientFirstName}
                          onChange={(e) => setClientFirstName(e.target.value.slice(0, 48))}
                          placeholder={t('crm.crm.createClientModal.введите_имя')}
                          className="w-full h-12.5 border-2 border-dream-primary/50 bg-dream-secondary rounded-full pl-5 py-2 focus:outline-none"
                          style={{
                            fontFamily: 'var(--font-sans)',
                            fontWeight: 400,
                            fontStyle: 'normal',
                            fontSize: '14px',
                            lineHeight: '100%',
                            letterSpacing: '0px',
                            leadingTrim: 'cap-height'
                          } as React.CSSProperties & { leadingTrim?: string }}
                        />
                      </div>

                      {/* Телефон */}
                      <div className='flex flex-col gap-3.5'>
                        <span 
                          className='text-black'
                          style={{
                            fontFamily: 'var(--font-sans)',
                            fontWeight: 400,
                            fontStyle: 'normal',
                            fontSize: '18px',
                            lineHeight: '150%',
                            letterSpacing: '-0.01em',
                            leadingTrim: 'none'
                          } as React.CSSProperties & { leadingTrim?: string }}
                        >{t('createClientModal.phone')}<span className="text-red-500">*</span>
                        </span>
                        <PhoneInput
                          value={clientPhone}
                          onChange={setClientPhone}
                          placeholder={t('createClientModal.phonePlaceholder')}
                          className="w-full h-12.5 border-2 border-dream-primary/50 bg-dream-secondary rounded-full pl-5 py-2 focus:outline-none"
                          style={{
                            fontFamily: 'var(--font-sans)',
                            fontWeight: 400,
                            fontStyle: 'normal',
                            fontSize: '14px',
                            lineHeight: '100%',
                            letterSpacing: '0px',
                            leadingTrim: 'cap-height'
                          } as React.CSSProperties & { leadingTrim?: string }}
                        />
                      </div>

                      {/* Email */}
                      <div className='flex flex-col gap-3.5'>
                        <span 
                          className='text-black'
                          style={{
                            fontFamily: 'var(--font-sans)',
                            fontWeight: 400,
                            fontStyle: 'normal',
                            fontSize: '18px',
                            lineHeight: '150%',
                            letterSpacing: '-0.01em',
                            leadingTrim: 'none'
                          } as React.CSSProperties & { leadingTrim?: string }}
                        >
                          Email
                        </span>
                        <input
                          type="text"
                          value={clientEmail}
                          onChange={(e) => setClientEmail(e.target.value)}
                          placeholder={t('createClientModal.emailPlaceholder')}
                          className="w-full h-12.5 border-2 border-dream-primary/50 bg-dream-secondary rounded-full pl-5 py-2 focus:outline-none"
                          style={{
                            fontFamily: 'var(--font-sans)',
                            fontWeight: 400,
                            fontStyle: 'normal',
                            fontSize: '14px',
                            lineHeight: '100%',
                            letterSpacing: '0px',
                            leadingTrim: 'cap-height'
                          } as React.CSSProperties & { leadingTrim?: string }}
                        />
                      </div>

                      {/* Город */}
                      <div className='flex flex-col gap-3.5'>
                        <span 
                          className='text-black'
                          style={{
                            fontFamily: 'var(--font-sans)',
                            fontWeight: 400,
                            fontStyle: 'normal',
                            fontSize: '18px',
                            lineHeight: '150%',
                            letterSpacing: '-0.01em',
                            leadingTrim: 'none'
                          } as React.CSSProperties & { leadingTrim?: string }}
                        >{t('createClientModal.city')}</span>
                        <div ref={cityDropdownRef} className="relative w-full">
                          <input
                            type="text"
                            value={selectedCity}
                            onChange={(e) => {
                              setSelectedCity(e.target.value);
                              setCitySearchQuery(e.target.value);
                              setIsCityDropdownOpen(true);
                            }}
                            onFocus={() => {
                              setIsCityDropdownOpen(true);
                              setCitySearchQuery(selectedCity);
                            }}
                            placeholder={t('crm.crm.createClientModal.введите_название_гор')}
                            className="w-full h-12.5 border-2 border-dream-primary/50 bg-dream-secondary rounded-full pl-5 py-2 focus:outline-none"
                            style={{
                              fontFamily: 'var(--font-sans)',
                              fontWeight: 400,
                              fontStyle: 'normal',
                              fontSize: '14px',
                              lineHeight: '100%',
                              letterSpacing: '0px',
                              leadingTrim: 'cap-height'
                            } as React.CSSProperties & { leadingTrim?: string }}
                          />
                          {isCityDropdownOpen && filteredCityOptions.length > 0 && (
                            <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-white border-2 border-dream-primary/50 rounded-[25px] shadow-lg max-h-60 overflow-y-auto">
                              {filteredCityOptions.slice(0, 20).map((city) => (
                                <button
                                  key={city}
                                  type="button"
                                  onClick={() => {
                                    setSelectedCity(city);
                                    setCitySearchQuery('');
                                    setIsCityDropdownOpen(false);
                                  }}
                                  className={`w-full px-5 py-3 text-left hover:bg-dream-secondary transition-all duration-200 ease-in-out hover:scale-[1.02] active:scale-95 ${
                                    selectedCity === city ? 'bg-dream-secondary' : ''
                                  }`}
                                >
                                  <span>
                                    {city}
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Объект - только для RP */}
                      {selectedProduct !== 'Net' && (
                        <div className='flex flex-col gap-3.5'>
                          <span 
                            className='text-black'
                            style={{
                              fontFamily: 'var(--font-sans)',
                              fontWeight: 400,
                              fontStyle: 'normal',
                              fontSize: '18px',
                              lineHeight: '150%',
                              letterSpacing: '-0.01em',
                              leadingTrim: 'none'
                            } as React.CSSProperties & { leadingTrim?: string }}
                          >{t('createClientModal.object')}</span>
                          <div ref={objectDropdownRef} className="relative w-full">
                            <button
                              type="button"
                              onClick={() => setIsObjectDropdownOpen(!isObjectDropdownOpen)}
                              className='flex items-center justify-between w-full h-12.5 border-2 border-dream-primary bg-dream-secondary rounded-full pl-5 pr-4 py-2 focus:outline-none'
                            >
                              <span 
                                className='text-dream-primary'
                                style={{
                                  fontFamily: 'var(--font-sans)',
                                  fontWeight: 400,
                                  fontStyle: 'normal',
                                  fontSize: '18px',
                                  lineHeight: '100%',
                                  letterSpacing: '0px',
                                  leadingTrim: 'cap-height'
                                } as React.CSSProperties & { leadingTrim?: string }}
                              >
                                {selectedObject}
                              </span>
                              <svg 
                                width="36" 
                                height="36" 
                                viewBox="0 0 36 36" 
                                fill="none" 
                                xmlns="http://www.w3.org/2000/svg"
                                className={`transition-transform duration-300 ease-in-out cursor-pointer ${isObjectDropdownOpen ? 'rotate-180' : ''}`}
                              >
                                <path d="M18.0009 19.757L25.4259 12.332L27.5469 14.453L18.0009 23.999L8.45488 14.453L10.5759 12.332L18.0009 19.757Z" fill="#169600"/>
                              </svg>
                            </button>
                            {isObjectDropdownOpen && (
                              <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-white border-2 border-dream-primary rounded-[25px] shadow-lg max-h-60 overflow-y-auto">
                                {objectOptions.map((option) => (
                                  <button
                                    key={option}
                                    type="button"
                                    onClick={() => {
                                      setSelectedObject(option);
                                      setIsObjectDropdownOpen(false);
                                    }}
                                    className={`w-full px-5 py-3 text-left hover:bg-dream-secondary transition-all duration-200 ease-in-out hover:scale-[1.02] active:scale-95 ${
                                      selectedObject === option ? 'bg-dream-secondary' : ''
                                    }`}
                                  >
                                    <span
                                      className='text-dream-primary'
                                      style={{
                                        fontFamily: 'var(--font-sans)',
                                        fontWeight: 400,
                                        fontStyle: 'normal',
                                        fontSize: '18px',
                                        lineHeight: '100%',
                                        letterSpacing: '0px',
                                        leadingTrim: 'cap-height'
                                      } as React.CSSProperties & { leadingTrim?: string }}
                                    >
                                      {option}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Колонка 2: Фамилия, Телеграм, Страна, Сделка (только для RP), Бюджет (только для RP) */}
                    <div className='flex flex-col gap-3.5'>
                      {/* Фамилия */}
                      <div className='flex flex-col gap-3.5'>
                        <span 
                          className='text-black'
                          style={{
                            fontFamily: 'var(--font-sans)',
                            fontWeight: 400,
                            fontStyle: 'normal',
                            fontSize: '18px',
                            lineHeight: '150%',
                            letterSpacing: '-0.01em',
                            leadingTrim: 'none'
                          } as React.CSSProperties & { leadingTrim?: string }}
                        >{t('createClientModal.lastName')}<span className="text-red-500">*</span>
                        </span>
                        <input
                          type="text"
                          maxLength={48}
                          value={clientLastName}
                          onChange={(e) => setClientLastName(e.target.value.slice(0, 48))}
                          placeholder={t('createClientModal.lastNamePlaceholder')}
                          className="w-full h-12.5 border-2 border-dream-primary/50 bg-dream-secondary rounded-full pl-5 py-2 focus:outline-none"
                          style={{
                            fontFamily: 'var(--font-sans)',
                            fontWeight: 400,
                            fontStyle: 'normal',
                            fontSize: '14px',
                            lineHeight: '100%',
                            letterSpacing: '0px',
                            leadingTrim: 'cap-height'
                          } as React.CSSProperties & { leadingTrim?: string }}
                        />
                      </div>

                      {/* Telegram */}
                      <div className='flex flex-col gap-3.5'>
                        <span className='text-black' style={{ fontFamily: 'var(--font-sans)', fontWeight: 400, fontSize: '18px', lineHeight: '150%' }}>{t('createClientModal.telegram')}</span>
                        <input
                          type="text"
                          maxLength={64}
                          value={clientTelegram}
                          onChange={(e) => setClientTelegram(e.target.value.slice(0, 64))}
                          placeholder="@username"
                          className="w-full h-12.5 border-2 border-dream-primary/50 bg-dream-secondary rounded-full pl-5 py-2 focus:outline-none"
                          style={{ fontFamily: 'var(--font-sans)', fontWeight: 400, fontSize: '14px', lineHeight: '100%' }}
                        />
                      </div>

                      {/* Страна */}
                      <div className='flex flex-col gap-3.5'>
                        <span className='text-black' style={{ fontFamily: 'var(--font-sans)', fontWeight: 400, fontSize: '18px', lineHeight: '150%' }}>
                          {t('crm.crm.createClientModal.страна')}</span>
                        <div ref={countryDropdownRef} className="relative w-full">
                          <div className="relative">
                            {selectedCountry && selectedCountry.flag && (
                              <span className="absolute left-5 top-1/2 -translate-y-1/2 text-lg pointer-events-none z-10">
                                {selectedCountry.flag}
                              </span>
                            )}
                            <input
                              type="text"
                              value={countrySearchQuery || (selectedCountry ? selectedCountry.name : '')}
                              onChange={(e) => {
                                const query = e.target.value;
                                setCountrySearchQuery(query);
                                setIsCountryDropdownOpen(true);
                                // Если поле очищено, сбрасываем выбранную страну
                                if (!query) {
                                  setSelectedCountry(null);
                                } else {
                                  // Проверяем, есть ли точное совпадение с названием страны
                                  const exactMatch = countriesList.find(
                                    country => country.name.toLowerCase() === query.toLowerCase()
                                  );
                                  if (exactMatch) {
                                    setSelectedCountry(exactMatch);
                                  }
                                }
                              }}
                              onFocus={() => {
                                setIsCountryDropdownOpen(true);
                                if (!countrySearchQuery && selectedCountry) {
                                  setCountrySearchQuery(selectedCountry.name);
                                }
                              }}
                              onBlur={() => {
                                // Не закрываем сразу, чтобы можно было кликнуть на вариант
                                setTimeout(() => {
                                  setIsCountryDropdownOpen(false);
                                  // Если есть выбранная страна, восстанавливаем её название
                                  if (selectedCountry && !countrySearchQuery) {
                                    setCountrySearchQuery(selectedCountry.name);
                                  } else if (!selectedCountry) {
                                    setCountrySearchQuery('');
                                  }
                                }, 200);
                              }}
                              placeholder={t('crm.crm.createClientModal.введите_название_стр')}
                              className='w-full h-12.5 border-2 border-dream-primary bg-dream-secondary rounded-full pr-4 py-2 focus:outline-none text-dream-primary'
                              style={{ 
                                fontFamily: 'var(--font-sans)', 
                                fontWeight: 400, 
                                fontSize: '18px', 
                                lineHeight: '100%',
                                paddingLeft: selectedCountry && selectedCountry.flag ? '3rem' : '1.25rem'
                              }}
                            />
                          </div>
                          {isCountryDropdownOpen && (
                            <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-white border-2 border-dream-primary rounded-[25px] shadow-lg max-h-60 overflow-y-auto">
                              {countriesList
                                .filter((option) => {
                                  if (!countrySearchQuery) return true;
                                  const query = countrySearchQuery.toLowerCase();
                                  return option.name.toLowerCase().includes(query) || 
                                         option.code.toLowerCase().includes(query);
                                })
                                .map((option) => (
                                  <button
                                    key={option.code}
                                    type="button"
                                    onClick={() => {
                                      setSelectedCountry(option);
                                      setCountrySearchQuery(option.name);
                                      setIsCountryDropdownOpen(false);
                                    }}
                                    className={`w-full px-5 py-3 text-left hover:bg-dream-secondary transition-all duration-200 ease-in-out hover:scale-[1.02] active:scale-95 ${selectedCountry?.code === option.code ? 'bg-dream-secondary' : ''}`}
                                  >
                                    <span className='text-dream-primary flex items-center gap-2' style={{ fontFamily: 'var(--font-sans)', fontWeight: 400, fontSize: '18px', lineHeight: '100%' }}>
                                      {option.flag && <span>{option.flag}</span>}
                                      {option.name}
                                    </span>
                                  </button>
                                ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Сделка - только для RP */}
                      {selectedProduct !== 'Net' && (
                        <div className='flex flex-col gap-3.5'>
                          <span 
                            className='text-black'
                            style={{
                              fontFamily: 'var(--font-sans)',
                              fontWeight: 400,
                              fontStyle: 'normal',
                              fontSize: '18px',
                              lineHeight: '150%',
                              letterSpacing: '-0.01em',
                              leadingTrim: 'none'
                            } as React.CSSProperties & { leadingTrim?: string }}
                          >
                            {t('crm.crm.createClientModal.сделка')}</span>
                          <div ref={dealDropdownRef} className="relative w-full">
                            <button
                              type="button"
                              onClick={() => setIsDealDropdownOpen(!isDealDropdownOpen)}
                              className='flex items-center justify-between w-full h-12.5 border-2 border-dream-primary bg-dream-secondary rounded-full pl-5 pr-4 py-2 focus:outline-none'
                            >
                              <span 
                                className='text-dream-primary'
                                style={{
                                  fontFamily: 'var(--font-sans)',
                                  fontWeight: 400,
                                  fontStyle: 'normal',
                                  fontSize: '18px',
                                  lineHeight: '100%',
                                  letterSpacing: '0px',
                                  leadingTrim: 'cap-height'
                                } as React.CSSProperties & { leadingTrim?: string }}
                              >
                                {selectedDeal}
                              </span>
                              <svg 
                                width="36" 
                                height="36" 
                                viewBox="0 0 36 36" 
                                fill="none" 
                                xmlns="http://www.w3.org/2000/svg"
                                className={`transition-transform duration-300 ease-in-out cursor-pointer ${isDealDropdownOpen ? 'rotate-180' : ''}`}
                              >
                                <path d="M18.0009 19.757L25.4259 12.332L27.5469 14.453L18.0009 23.999L8.45488 14.453L10.5759 12.332L18.0009 19.757Z" fill="#169600"/>
                              </svg>
                            </button>
                            {isDealDropdownOpen && (
                              <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-white border-2 border-dream-primary rounded-[25px] shadow-lg max-h-60 overflow-y-auto">
                                {dealOptions.map((option) => (
                                  <button
                                    key={option}
                                    type="button"
                                    onClick={() => {
                                      setSelectedDeal(option);
                                      setIsDealDropdownOpen(false);
                                    }}
                                    className={`w-full px-5 py-3 text-left hover:bg-dream-secondary transition-all duration-200 ease-in-out hover:scale-[1.02] active:scale-95 ${
                                      selectedDeal === option ? 'bg-dream-secondary' : ''
                                    }`}
                                  >
                                    <span
                                      className='text-dream-primary'
                                      style={{
                                        fontFamily: 'var(--font-sans)',
                                        fontWeight: 400,
                                        fontStyle: 'normal',
                                        fontSize: '18px',
                                        lineHeight: '100%',
                                        letterSpacing: '0px',
                                        leadingTrim: 'cap-height'
                                      } as React.CSSProperties & { leadingTrim?: string }}
                                    >
                                      {option}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Бюджет - только для RP */}
                      {selectedProduct !== 'Net' && (
                        <div className='flex flex-col gap-3.5'>
                          <span 
                            className='text-black'
                            style={{
                              fontFamily: 'var(--font-sans)',
                              fontWeight: 400,
                              fontStyle: 'normal',
                              fontSize: '18px',
                              lineHeight: '150%',
                              letterSpacing: '-0.01em',
                              leadingTrim: 'none'
                            } as React.CSSProperties & { leadingTrim?: string }}
                          >
                            {t('crm.crm.createClientModal.бюджет')}</span>
                          <div className='w-full h-12.5 flex items-center justify-between border-2 border-dream-primary/50 bg-dream-secondary rounded-full pl-5 focus:outline-none'>
                            <input
                              type="text"
                              value={clientBudget}
                              onChange={(e) => {
                                const formatted = formatBudget(e.target.value);
                                setClientBudget(formatted);
                              }}
                              placeholder={t('crm.crm.createClientModal.укажите_бюджет')}
                              className="w-full focus:outline-none bg-transparent"
                              style={{
                                fontFamily: 'var(--font-sans)',
                                fontWeight: 400,
                                fontStyle: 'normal',
                                fontSize: '14px',
                                lineHeight: '100%',
                                letterSpacing: '0px',
                                leadingTrim: 'cap-height'
                              } as React.CSSProperties & { leadingTrim?: string }}
                            />
                            <div ref={currencyDropdownRef} className="relative h-full">
                              <button
                                type="button"
                                onClick={() => setIsCurrencyDropdownOpen(!isCurrencyDropdownOpen)}
                                className='flex items-center pl-3.5 pr-1 h-full rounded-full bg-dream-primary/30 focus:outline-none'
                              >
                                <span 
                                  className='text-dream-primary'
                                  style={{
                                    fontFamily: 'var(--font-sans)',
                                    fontWeight: 400,
                                    fontStyle: 'normal',
                                    fontSize: '18px',
                                    lineHeight: '100%',
                                    letterSpacing: '0px',
                                    leadingTrim: 'cap-height'
                                  } as React.CSSProperties & { leadingTrim?: string }}
                                >
                                  {selectedCurrency}
                                </span>
                                <svg 
                                  width="36" 
                                  height="36" 
                                  viewBox="0 0 36 36" 
                                  fill="none" 
                                  xmlns="http://www.w3.org/2000/svg"
                                  className={`transition-transform duration-300 ease-in-out ${isCurrencyDropdownOpen ? 'rotate-180' : ''}`}
                                >
                                  <path d="M18.0009 19.757L25.4259 12.332L27.5469 14.453L18.0009 23.999L8.45488 14.453L10.5759 12.332L18.0009 19.757Z" fill="#169600"/>
                                </svg>
                              </button>
                              {isCurrencyDropdownOpen && (
                                <div className="absolute bottom-full right-0 mb-1 z-50 bg-white border-2 border-dream-primary rounded-[25px] shadow-lg min-w-full overflow-y-auto">
                                  {currencyOptions.map((option) => (
                                    <button
                                      key={option}
                                      type="button"
                                      onClick={() => {
                                        setSelectedCurrency(option);
                                        setIsCurrencyDropdownOpen(false);
                                      }}
                                      className={`w-full px-5 py-3 text-left hover:bg-dream-secondary transition-all duration-200 ease-in-out hover:scale-[1.02] active:scale-95 whitespace-nowrap ${
                                        selectedCurrency === option ? 'bg-dream-secondary' : ''
                                      }`}
                                    >
                                      <span 
                                        className="text-dream-primary"
                                        style={{
                                          fontFamily: 'var(--font-sans)',
                                          fontWeight: 400,
                                          fontStyle: 'normal',
                                          fontSize: '18px',
                                          lineHeight: '100%',
                                          letterSpacing: '0px',
                                          leadingTrim: 'cap-height'
                                        } as React.CSSProperties & { leadingTrim?: string }}
                                      >
                                        {option}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
              {lead && (
                <div className='w-full flex flex-col gap-3.5 mt-3.5'>
                  <div className='w-full flex items-center justify-between'>
                    <span 
                      className='text-black'
                      style={{
                        fontFamily: 'var(--font-sans)',
                        fontWeight: 400,
                        fontStyle: 'normal',
                        fontSize: '18px',
                        lineHeight: '150%',
                        letterSpacing: '-0.01em',
                        leadingTrim: 'none'
                      } as React.CSSProperties & { leadingTrim?: string }}
                    >
                      {t('crm.crm.createClientModal.подробное_описание')}</span>
                    <button 
                      type="button"
                      onClick={() => setClientDescription('')}
                      className='flex items-center gap-1 py-2 px-2.5 hover:opacity-80 transition-opacity bg-dream-secondary rounded-lg text-dream-primary'
                    >
                      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <g clipPath="url(#clip0_4604_65625)">
                        <path d="M14.9062 2.25H11.8125V1.6875C11.8125 0.75702 11.0555 0 10.125 0H7.875C6.94452 0 6.1875 0.75702 6.1875 1.6875V2.25H3.09375C2.31834 2.25 1.6875 2.88084 1.6875 3.65625V5.625C1.6875 5.93564 1.93936 6.1875 2.25 6.1875H2.55741L3.04337 16.3928C3.0863 17.294 3.82669 18 4.72894 18H13.2711C14.1733 18 14.9137 17.294 14.9566 16.3928L15.4426 6.1875H15.75C16.0606 6.1875 16.3125 5.93564 16.3125 5.625V3.65625C16.3125 2.88084 15.6817 2.25 14.9062 2.25ZM7.3125 1.6875C7.3125 1.37735 7.56485 1.125 7.875 1.125H10.125C10.4351 1.125 10.6875 1.37735 10.6875 1.6875V2.25H7.3125V1.6875ZM2.8125 3.65625C2.8125 3.50118 2.93868 3.375 3.09375 3.375H14.9062C15.0613 3.375 15.1875 3.50118 15.1875 3.65625V5.0625C15.0141 5.0625 3.53085 5.0625 2.8125 5.0625V3.65625ZM13.8329 16.3393C13.8186 16.6397 13.5718 16.875 13.2711 16.875H4.72894C4.42818 16.875 4.18138 16.6397 4.16711 16.3393L3.68367 6.1875H14.3163L13.8329 16.3393Z" fill="#169600"/>
                        <path d="M9 15.75C9.31064 15.75 9.5625 15.4981 9.5625 15.1875V7.875C9.5625 7.56436 9.31064 7.3125 9 7.3125C8.68936 7.3125 8.4375 7.56436 8.4375 7.875V15.1875C8.4375 15.4981 8.68932 15.75 9 15.75Z" fill="#169600"/>
                        <path d="M11.8125 15.75C12.1231 15.75 12.375 15.4981 12.375 15.1875V7.875C12.375 7.56436 12.1231 7.3125 11.8125 7.3125C11.5019 7.3125 11.25 7.56436 11.25 7.875V15.1875C11.25 15.4981 11.5018 15.75 11.8125 15.75Z" fill="#169600"/>
                        <path d="M6.1875 15.75C6.49814 15.75 6.75 15.4981 6.75 15.1875V7.875C6.75 7.56436 6.49814 7.3125 6.1875 7.3125C5.87686 7.3125 5.625 7.56436 5.625 7.875V15.1875C5.625 15.4981 5.87682 15.75 6.1875 15.75Z" fill="#169600"/>
                        </g>
                        <defs>
                        <clipPath id="clip0_4604_65625">
                        <rect width="18" height="18" fill="white"/>
                        </clipPath>
                        </defs>
                      </svg>
                      <span
                        style={{
                          fontFamily: 'var(--font-sans)',
                          fontWeight: 400,
                          fontStyle: 'normal',
                          fontSize: '14px',
                          lineHeight: '24px',
                          letterSpacing: '0px',
                          leadingTrim: 'none'
                        } as React.CSSProperties & { leadingTrim?: string }}
                      >
                        {t('crm.crm.createClientModal.очистить')}</span>
                    </button>
                  </div>
                  <div className="relative">
                    <textarea
                      maxLength={1000}
                      value={clientDescription}
                      onChange={(e) => setClientDescription(e.target.value.slice(0, 1000))}
                      placeholder={t('crm.crm.createClientModal.введите_подробное_оп')}
                      className="w-full h-71.5 border-2 border-dream-primary/50 bg-dream-secondary rounded-lg pl-5 pr-16 py-2 focus:outline-none resize-none break-words overflow-y-auto"
                      style={{
                        fontFamily: 'var(--font-sans)',
                        fontWeight: 400,
                        fontStyle: 'normal',
                        fontSize: '14px',
                        lineHeight: '28px',
                        letterSpacing: '0px',
                        leadingTrim: 'cap-height'
                      } as React.CSSProperties & { leadingTrim?: string }}
                    />
                    <span 
                      className="absolute right-5 bottom-2 text-gray-500 text-sm"
                      style={{
                        fontFamily: 'var(--font-sans)',
                        fontWeight: 400,
                        fontStyle: 'normal',
                        fontSize: '14px',
                        lineHeight: '28px',
                        letterSpacing: '0px',
                        leadingTrim: 'cap-height'
                      } as React.CSSProperties & { leadingTrim?: string }}
                    >
                      {clientDescription.length}/1000
                    </span>
                  </div>
                </div>
              )}
              {/* Блок с файлами только в режиме редактирования */}
              {lead && (
                <div className='flex flex-col gap-3.5 mt-3.5'>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    onChange={handleFileSelect}
                    className="hidden"
                    accept="*/*"
                  />
                  
                  <button 
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center py-2 px-3 w-fit rounded-full border border-dashed border-gray-300 cursor-pointer hover:border-dream-primary hover:bg-dream-secondary/50 transition-colors"
                  >
                    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M18 3H14C12.6744 3.00156 11.4035 3.52885 10.4662 4.46619C9.52885 5.40353 9.00156 6.6744 9 8V28C9 28.2652 9.10536 28.5196 9.29289 28.7071C9.48043 28.8946 9.73478 29 10 29C10.2652 29 10.5196 28.8946 10.7071 28.7071C10.8946 28.5196 11 28.2652 11 28V8C11.0009 7.20462 11.3172 6.44206 11.8796 5.87964C12.4421 5.31722 13.2046 5.00087 14 5H18C18.7954 5.00087 19.5579 5.31722 20.1204 5.87964C20.6828 6.44206 20.9991 7.20462 21 8V24C21 24.7956 20.6839 25.5587 20.1213 26.1213C19.5587 26.6839 18.7956 27 18 27C17.2044 27 16.4413 26.6839 15.8787 26.1213C15.3161 25.5587 15 24.7956 15 24V11C15 10.7348 15.1054 10.4804 15.2929 10.2929C15.4804 10.1054 15.7348 10 16 10C16.2652 10 16.5196 10.1054 16.7071 10.2929C16.8946 10.4804 17 10.7348 17 11V23C17 23.2652 17.1054 23.5196 17.2929 23.7071C17.4804 23.8946 17.7348 24 18 24C18.2652 24 18.5196 23.8946 18.7071 23.7071C18.8946 23.5196 19 23.2652 19 23V11C19 10.2044 18.6839 9.44129 18.1213 8.87868C17.5587 8.31607 16.7956 8 16 8C15.2044 8 14.4413 8.31607 13.8787 8.87868C13.3161 9.44129 13 10.2044 13 11V24C13 25.3261 13.5268 26.5979 14.4645 27.5355C15.4021 28.4732 16.6739 29 18 29C19.3261 29 20.5979 28.4732 21.5355 27.5355C22.4732 26.5979 23 25.3261 23 24V8C22.9984 6.6744 22.4712 5.40353 21.5338 4.46619C20.5965 3.52885 19.3256 3.00156 18 3Z" fill="#555454"/>
                    </svg>
                    <span
                      style={{
                        fontFamily: 'var(--font-sans)',
                        fontWeight: 400,
                        fontStyle: 'normal',
                        fontSize: '14px',
                        lineHeight: '24px',
                        letterSpacing: '0px',
                        leadingTrim: 'none'
                      } as React.CSSProperties & { leadingTrim?: string }}
                    >{t('createClientModal.attachMax')}</span>
                  </button>
                  
                  {/* Существующие файлы (только в режиме редактирования) */}
                  {existingFiles.length > 0 && (
                    <div className="w-full flex flex-col gap-2">
                      <p className="text-xs text-gray-500">{t('crm.crm.createClientModal.существующие_файлы')}{existingFiles.filter(f => !deletedFiles.includes(f.filename)).length}</p>
                      {existingFiles
                        .filter(file => !deletedFiles.includes(file.filename))
                        .map((file) => (
                          <div key={file.filename} className="flex items-center justify-between bg-gray-50 rounded-lg p-3 border border-gray-200">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              {file.mimeType?.includes('image') && file.url ? (
                                <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 bg-gray-200">
                                  <img 
                                    src={file.url} 
                                    alt={file.originalName}
                                    className="w-full h-full object-cover"
                                    onError={(e) => {
                                      (e.target as HTMLImageElement).style.display = 'none';
                                    }}
                                  />
                                </div>
                              ) : (
                                getFileIcon(file.mimeType || '', 20)
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-700 truncate">{file.originalName}</p>
                                <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setDeletedFiles(prev => {
                                  const updated = [...prev, file.filename];
                                  return updated;
                                });
                              }}
                              className="ml-2 p-1 text-red-600 hover:bg-red-50 rounded transition-colors"
                              title={t('createClientModal.delete')}
                            >
                              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M14 4L4 14M4 4l10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                              </svg>
                            </button>
                          </div>
                        ))}
                    </div>
                  )}
                  {/* Новые файлы для загрузки */}
                  {selectedFiles.length > 0 && (
                    <div className="w-full flex flex-col gap-2">
                      <p className="text-xs text-gray-500">{t('crm.crm.createClientModal.выбрано_файлов')}{selectedFiles.length}</p>
                      {selectedFiles.map((file, index) => (
                        <div key={index} className="flex items-center justify-between bg-gray-50 rounded-lg p-3 border border-gray-200">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M11 1H4a1 1 0 00-1 1v16a1 1 0 001 1h12a1 1 0 001-1V6l-6-5z" fill="#4B5563"/>
                              <path d="M11 1v5h5" fill="#9CA3AF"/>
                            </svg>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-700 truncate">{file.name}</p>
                              <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveFile(index)}
                            className="ml-2 p-1 text-red-600 hover:bg-red-50 rounded transition-colors"
                            title={t('createClientModal.delete')}
                          >
                            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M14 4L4 14M4 4l10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {submitError && (
                <div className="w-full p-3 bg-red-100 text-red-600 rounded-lg text-sm">
                  {submitError}
                </div>
              )}
              <div className='w-full flex items-center justify-center gap-3 flex-wrap mt-10 '>
                {lead && (
                  <button 
                    onClick={handleClearAllInfo}
                    disabled={isSubmitting || isUploadingFiles}
                    className='px-12 py-3 h-12.5 bg-red-600 hover:bg-red-700 rounded-full text-white text-base leading-[150%] tracking-normal disabled:bg-gray-400 disabled:cursor-not-allowed transition-all duration-200 ease-in-out cursor-pointer hover:scale-105 active:scale-95 disabled:hover:scale-100'
                    style={{
                      fontFamily: 'var(--font-sans)',
                    }}
                  >
                    {isSubmitting ? 'Очистка...' : 'Очистить информацию'}
                  </button>
                )}
                <button 
                  onClick={handleSaveLead}
                  disabled={
                    ((selectedProduct === 'Net' || selectedProduct === 'RP' || selectedProduct === 'Owner' || selectedProduct === 'Agent') ? (!clientFirstName.trim() || !clientLastName.trim()) : !clientName.trim()) || 
                    !clientPhone.trim() || 
                    isSubmitting || 
                    isUploadingFiles ||
                    (!!lead && !hasChanges()) // В режиме редактирования кнопка неактивна без изменений
                  }
                  className='px-12 py-3 h-12.5 bg-dream-primary rounded-full text-white text-base leading-[150%] tracking-normal disabled:bg-gray-400 disabled:cursor-not-allowed transition-all duration-200 ease-in-out cursor-pointer hover:scale-105 active:scale-95 disabled:hover:scale-100'
                  style={{
                    fontFamily: 'var(--font-sans)',
                  }}
                >
                  {(isSubmitting || isUploadingFiles) ? 'Сохранение...' : 'Сохранить'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* Модалка подтверждения закрытия */}
      {showConfirmClose && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[70] pt-4 md:pt-4 pb-0 md:pb-4 px-0 md:px-4 transition-all duration-300 ease-out animate-in fade-in" onClick={handleCancelClose}>
          <div className="relative bg-white rounded-[25px] shadow-2xl p-8 max-w-md w-full mx-4 animate-in zoom-in-95 slide-in-from-bottom-4 duration-300" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-normal mb-4 text-dream-primary">
              {t('crm.crm.createClientModal.хотите_закрыть')}</h3>
            <p className="text-gray-700 mb-6">
              {t('crm.crm.createClientModal.у_вас_есть_несохране')}</p>
            <div className="flex gap-4 justify-end">
              <button
                onClick={handleCancelClose}
                className="px-6 py-2 border-2 border-gray-300 rounded-full text-gray-700 hover:bg-gray-50 transition-all duration-200 ease-in-out hover:scale-105 active:scale-95"
              >{t('createClientModal.cancel')}</button>
              <button
                onClick={handleConfirmClose}
                className="px-6 py-2 bg-dream-primary rounded-full text-white hover:bg-dream-primary/90 transition-all duration-200 ease-in-out hover:scale-105 active:scale-95"
              >
                {t('crm.crm.createClientModal.закрыть_без_сохранен')}</button>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body
  );
};

export default CreateClientModal;

