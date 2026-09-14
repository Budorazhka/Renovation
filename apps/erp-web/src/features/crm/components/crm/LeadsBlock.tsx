import React, { useState, useRef, useMemo, useEffect, useLayoutEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { useI18n } from '@/i18n';
import type { Lead } from '../../services/api';

const LEAD_TAGS_RECENT_KEY = 'leadTagsRecent';
function getRecentLeadTags(): string[] {
  try {
    return JSON.parse(localStorage.getItem(LEAD_TAGS_RECENT_KEY) || '[]');
  } catch {
    return [];
  }
}
function addRecentLeadTag(tag: string): void {
  const arr = getRecentLeadTags();
  const next = [tag, ...arr.filter((t) => t !== tag)].slice(0, 30);
  localStorage.setItem(LEAD_TAGS_RECENT_KEY, JSON.stringify(next));
}
import { LeadStage, ProductType } from '../../services/api';
import { resolveDuplicateLeadForUser } from '../../utils/leadDuplicateHelper';
import { leadsApiV2, newIdempotencyKey } from '@/services/leadsApiV2';
import { mapLeadV2ToCrmLead, mapProductTypeCrmToV2, stageCrmToV2 } from '@/lib/lead-v2-legacy-adapter';
import { OLD_BASE_TAG } from '@/services/leadsApiV2';
import FilterDropdown from './FilterDropdown';
import AddLeadModal from './AddLeadModal';
import CreateClientModal from './CreateClientModal';
import LeadViewModal from './LeadViewModal';
import Tooltip from '../common/Tooltip';
import MobileStageModal from './MobileStageModal';
import { compareLeadListOrder } from './leadSorting';

type ProductTab = 'RP' | 'Net' | 'Owner' | 'Agent';

interface LeadRecord {
  id: string;
  imageUrl: string;
  name: string;
  date: string;
  type: ProductTab;
  city: string;
  stage?: LeadStage;
  stageLabel: string;
  createdAt?: string;
  updatedAt?: string;
  productType?: ProductType;
  category?: 'leads' | 'inWork' | 'bought';
  backendIndex?: number;
  budgetValue?: number;
  tags?: string[]; // до 2 тегов на лида
}

interface LeadsBlockProps {
  backendLeads: Lead[];
  onUpdateLeads: (leads: Lead[]) => void;
  onUpdateLead?: (leadId: string, updates: Partial<Lead>, modifiedFields: string[]) => void;
  onUpdateLeadAfterSync?: (leadId: string, syncedLead: Lead) => void;
  onLoadLeads: () => Promise<void>;
  onLeadStageChange?: (leadId: string, leadName: string, stageLabel: string, stage: LeadStage, productType: ProductType) => void;
  onOpenNewTaskModal?: (leadId: string) => void;
  onOpenTaskManagementModal?: () => void;
  activeLeadId?: string;
  onLeadDeleted?: (leadId: string) => void;
  onProductChange?: (product: ProductTab) => void;
  onCloseChecklist?: () => void;
}

const LeadsBlock: React.FC<LeadsBlockProps> = ({ backendLeads, onUpdateLeads, onUpdateLead, onUpdateLeadAfterSync, onLoadLeads, onLeadStageChange, onOpenNewTaskModal, onOpenTaskManagementModal, activeLeadId, onLeadDeleted, onProductChange, onCloseChecklist }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useI18n();
  // Системная метка импорта показывается подписью, а не машинным значением.
  const tagLabel = (tag: string) => (tag === OLD_BASE_TAG ? t('crmPoker.oldBaseFilter') : tag);
  const [selectedProduct, setSelectedProduct] = useState<ProductTab>('RP');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [selectedTab, setSelectedTab] = useState<'all' | 'leads' | 'inWork' | 'bought'>('all');
  const [buttonPositions, setButtonPositions] = useState<{ [key: string]: { left: number; width: number } }>({});
  const [draggedOverColumn, setDraggedOverColumn] = useState<number | null>(null);
  const [sliderPositions, setSliderPositions] = useState<{ [key: string]: number }>({});
  const [isLeadsBlockCollapsed, setIsLeadsBlockCollapsed] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  const [isSizeMenuOpen, setIsSizeMenuOpen] = useState(false);
  const sizeMenuButtonRef = useRef<HTMLButtonElement>(null);
  const sizeMenuRef = useRef<HTMLDivElement>(null);
  const [columnWidth, setColumnWidth] = useState(() => {
    const saved = localStorage.getItem('leadsColumnWidth');
    return saved ? Number(saved) : 50;
  });
  const [fontSize, setFontSize] = useState(() => {
    const saved = localStorage.getItem('leadsFontSize');
    return saved ? Number(saved) : 50;
  });
  const [showChecklist, setShowChecklist] = useState(() => {
    if (typeof window === 'undefined') return true;
    return (localStorage.getItem('leadsShowChecklist') ?? '').trim() !== 'false';
  });
  const [pinnedLeadId, setPinnedLeadId] = useState<string | null>(() => {
    const saved = localStorage.getItem('pinnedLeadId');
    return saved || null;
  });
  const [isDragging, setIsDragging] = useState(false);
  const sliderTrackRef = useRef<HTMLDivElement>(null);
  const dragStartMapRef = useRef<Map<string, boolean>>(new Map());
  const [isFiltersMenuOpen, setIsFiltersMenuOpen] = useState(false);
  const filtersMenuButtonRef = useRef<HTMLButtonElement>(null);
  const filtersMenuRef = useRef<HTMLDivElement>(null);
  const [filtersMenuPosition, setFiltersMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [sizeMenuPosition, setSizeMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [selectedStages, setSelectedStages] = useState<string[]>([]);
  const [_selectedRegions, _setSelectedRegions] = useState<string[]>([]);
  const [_startDate, _setStartDate] = useState<string>('');
  const [_endDate, _setEndDate] = useState<string>('');
  const [minBudget, setMinBudget] = useState<string>('');
  const [maxBudget, setMaxBudget] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [isAddLeadModalOpen, setIsAddLeadModalOpen] = useState(false);
  const [isCreateClientModalOpen, setIsCreateClientModalOpen] = useState(false);
  const [initialStageForNewClient, setInitialStageForNewClient] = useState<{ stage: LeadStage; statusIndex: number } | null>(null);
  const [isLeadViewModalOpen, setIsLeadViewModalOpen] = useState(() => {
    return searchParams.get('modal') === 'lead' && !!searchParams.get('leadId');
  });
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [initialTab, setInitialTab] = useState<'tasks' | 'objects' | 'info' | 'history'>(() => {
    const tab = searchParams.get('tab') as 'tasks' | 'objects' | 'info' | 'history' | null;
    return tab || 'history';
  });
  const [disappearingCards, setDisappearingCards] = useState<Set<string>>(new Set());
  const [cardSwipeDirections, setCardSwipeDirections] = useState<Record<string, 'left' | 'right'>>({});
  const [animationOldPositions, setAnimationOldPositions] = useState<Record<string, number>>({});
  const [openContactMenu, setOpenContactMenu] = useState<string | null>(null); // ID лида для открытого меню контактов
  const contactMenuRef = useRef<HTMLDivElement>(null);
  const [contactMenuPosition, setContactMenuPosition] = useState<{ top: number; left?: number; right?: number } | null>(null);
  const [activeTooltip, setActiveTooltip] = useState<{ id: string; text: string; position: { top: number; left: number } } | null>(null);
  const [isMobileStageModalOpen, setIsMobileStageModalOpen] = useState(false);
  const [selectedLeadForStageModal, setSelectedLeadForStageModal] = useState<LeadRecord | null>(null);
  const [openTagEditor, setOpenTagEditor] = useState<{ leadId: string; slotIndex: number } | null>(null);
  const [tagEditorAnchor, setTagEditorAnchor] = useState<{ top: number; left: number } | null>(null);
  const tagEditorInputRef = useRef<HTMLInputElement>(null);
  const tagEditorRef = useRef<HTMLDivElement | null>(null);
  const sanitizeBudgetValue = (value: string) => value.replace(/\D/g, '');

  const updateFiltersMenuPosition = useCallback(() => {
    if (typeof window === 'undefined') return;
    const button = filtersMenuButtonRef.current;
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const menuWidth = 333;
    const gap = 10;
    const viewportPadding = 16;
    const left = Math.min(
      Math.max(viewportPadding, rect.right - menuWidth),
      window.innerWidth - menuWidth - viewportPadding
    );
    const top = Math.min(rect.bottom + gap, window.innerHeight - viewportPadding);

    setFiltersMenuPosition({ top, left });
  }, []);

  /** Меню размера — fixed + portal: иначе родитель с overflow-x скрывает выпадашку по вертикали. */
  const updateSizeMenuPosition = useCallback(() => {
    if (typeof window === 'undefined') return;
    const button = sizeMenuButtonRef.current;
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const menuWidth = 370;
    const menuHeightEst = 300;
    const gap = 8;
    const pad = 12;

    let left = rect.right - menuWidth;
    left = Math.max(pad, Math.min(left, window.innerWidth - menuWidth - pad));

    let top = rect.bottom + gap;
    if (top + menuHeightEst > window.innerHeight - pad) {
      top = Math.max(pad, rect.top - menuHeightEst - gap);
    }

    setSizeMenuPosition({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (!isSizeMenuOpen) {
      setSizeMenuPosition(null);
      return;
    }
    updateSizeMenuPosition();
  }, [isSizeMenuOpen, updateSizeMenuPosition]);

  useEffect(() => {
    if (!isSizeMenuOpen) return;

    updateSizeMenuPosition();
    window.addEventListener('resize', updateSizeMenuPosition);
    window.addEventListener('scroll', updateSizeMenuPosition, true);

    return () => {
      window.removeEventListener('resize', updateSizeMenuPosition);
      window.removeEventListener('scroll', updateSizeMenuPosition, true);
    };
  }, [isSizeMenuOpen, updateSizeMenuPosition]);

  useEffect(() => {
    if (!isFiltersMenuOpen) return;

    updateFiltersMenuPosition();
    window.addEventListener('resize', updateFiltersMenuPosition);
    window.addEventListener('scroll', updateFiltersMenuPosition, true);

    return () => {
      window.removeEventListener('resize', updateFiltersMenuPosition);
      window.removeEventListener('scroll', updateFiltersMenuPosition, true);
    };
  }, [isFiltersMenuOpen, updateFiltersMenuPosition]);

  useEffect(() => {
    if (!openTagEditor) return;
    const onMouseDown = (e: MouseEvent) => {
      if (tagEditorRef.current && !tagEditorRef.current.contains(e.target as Node)) {
        setOpenTagEditor(null);
        setTagEditorAnchor(null);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [openTagEditor]);

  const funnelProperties: Record<ProductTab, Record<'leads' | 'inWork' | 'bought', string[]>> = {
    RP: {
      leads: [t('leadsBlock.defectiveLead'), t('leadsBlock.reject'), t('leadsBlock.noAnswer3'), t('leadsBlock.noAnswer2'), t('leadsBlock.noAnswer1')],
      inWork: [t('leadsBlock.newLead'), t('leadsBlock.callbackLater'), t('leadsBlock.presentedCompany'), t('leadsBlock.discussedSituation'), t('leadsBlock.identifiedNeed'), t('leadsBlock.needAdjusted'), t('leadsBlock.cpSent'), t('leadsBlock.handlingObjections'), t('leadsBlock.deferredDemandLead'), t('leadsBlock.warmingUp'), t('leadsBlock.showingLead'), t('leadsBlock.depositReceived'), t('leadsBlock.contractSigned')],
      bought: [t('leadsBlock.goldenFund'), t('leadsBlock.findOutHowThingsAre'), t('leadsBlock.takeRecommendation'), t('leadsBlock.newDealsNeeds')]
    },
    Net: {
      leads: [t('leadsBlock.defectiveLead'), t('leadsBlock.reject'), t('leadsBlock.noAnswer3'), t('leadsBlock.noAnswer2'), t('leadsBlock.noAnswer1')],
      inWork: [t('leadsBlock.newLead'), t('leadsBlock.callbackLater'), t('leadsBlock.presentedStrategy'), t('leadsBlock.presentedPlatform'), t('leadsBlock.offered'), t('leadsBlock.objectionsHandling'), t('leadsBlock.deferredDemandLead'), t('leadsBlock.agreement'), t('leadsBlock.formFilled'), t('leadsBlock.lkRegistration'), t('leadsBlock.offerSigned'), t('leadsBlock.workStarted')],
      bought: []
    },
    Owner: {
      leads: [t('leadsBlock.defectiveContact'), t('leadsBlock.ownerRefusal'), t('leadsBlock.noAnswerOwner3'), t('leadsBlock.noAnswerOwner2'), t('leadsBlock.noAnswerOwner1')],
      inWork: [t('leadsBlock.newOwner'), t('leadsBlock.callbackLater'), t('leadsBlock.presentedCompany'), t('leadsBlock.discussedProperty'), t('leadsBlock.offeredPhotoshoot'), t('leadsBlock.offeredExclusive'), t('leadsBlock.handledObjections'), t('leadsBlock.agreedCooperation'), t('leadsBlock.propertyActive'), t('leadsBlock.takeRecommendation'), t('leadsBlock.learnNewProperty')],
      bought: []
    },
    Agent: {
      leads: [t('leadsBlock.defectiveContact'), t('leadsBlock.reject'), t('leadsBlock.noAnswerOwner3'), t('leadsBlock.noAnswerOwner2'), t('leadsBlock.noAnswerOwner1')],
      inWork: [t('leadsBlock.newBroker'), t('leadsBlock.callbackLater'), t('leadsBlock.presentedCompany'), t('leadsBlock.cooperationFormat'), t('leadsBlock.objectionsHandling'), t('leadsBlock.agreedToCooperate'), t('leadsBlock.activeBroker')],
      bought: []
    }
  };

  const statusToLeadStageMap: Record<ProductTab, Record<string, LeadStage>> = {
    RP: {
      [t('leadsBlock.defectiveLead')]: LeadStage.REJECTED,
      [t('leadsBlock.reject')]: LeadStage.FIRST_CONTACT,
      [t('leadsBlock.noAnswer3')]: LeadStage.QUALIFICATION,
      [t('leadsBlock.noAnswer2')]: LeadStage.REJECTED1,
      [t('leadsBlock.noAnswer1')]: LeadStage.FIRST_CONTACT1,

      [t('leadsBlock.newLead')]: LeadStage.NEEDS_ANALYSIS,
      [t('leadsBlock.callbackLater')]: LeadStage.PRESENTATION,
      [t('leadsBlock.presentedCompany')]: LeadStage.PROPOSAL,
      [t('leadsBlock.discussedSituation')]: LeadStage.NEGOTIATION,
      [t('leadsBlock.identifiedNeed')]: LeadStage.DECISION_MAKING,
      [t('leadsBlock.needAdjusted')]: LeadStage.CONTRACT_SIGNING,
      [t('leadsBlock.cpSent')]: LeadStage.ONBOARDING,
      [t('leadsBlock.handlingObjections')]: LeadStage.NEEDS_ANALYSIS1,
      [t('leadsBlock.deferredDemandLead')]: LeadStage.PRESENTATION1,
      [t('leadsBlock.warmingUp')]: LeadStage.PROPOSAL1,
      [t('leadsBlock.showingLead')]: LeadStage.NEGOTIATION1,
      [t('leadsBlock.depositReceived')]: LeadStage.DECISION_MAKING1,
      [t('leadsBlock.contractSigned')]: LeadStage.CONTRACT_SIGNING1,

      [t('leadsBlock.goldenFund')]: LeadStage.DEAL_CLOSED,
      [t('leadsBlock.findOutHowThingsAre')]: LeadStage.POST_PURCHASE_FOLLOWUP,
      [t('leadsBlock.takeRecommendation')]: LeadStage.SATISFACTION_CHECK,
      [t('leadsBlock.newDealsNeeds')]: LeadStage.UPSELL_OPPORTUNITY,
    },
    Net: {
      [t('leadsBlock.defectiveLead')]: LeadStage.NETWORK_REJECTED_DEFECTIVE,
      [t('leadsBlock.reject')]: LeadStage.NETWORK_REJECTED,
      [t('leadsBlock.noAnswer3')]: LeadStage.NETWORK_NO_CALL_3,
      [t('leadsBlock.noAnswer2')]: LeadStage.NETWORK_NO_CALL_2,
      [t('leadsBlock.noAnswer1')]: LeadStage.NETWORK_NO_CALL_1,
      
      [t('leadsBlock.newLead')]: LeadStage.NETWORK_NEW_LEAD,
      [t('leadsBlock.callbackLater')]: LeadStage.NETWORK_CALL_LATER,
      [t('leadsBlock.presentedStrategy')]: LeadStage.NETWORK_COMPANY_PRESENTED,
      [t('leadsBlock.presentedPlatform')]: LeadStage.NETWORK_PLATFORM_PRESENTED,
      [t('leadsBlock.offered')]: LeadStage.NETWORK_OFFER_GIVEN,
      [t('leadsBlock.objectionsHandling')]: LeadStage.NETWORK_OBJECTIONS,
      [t('leadsBlock.deferredDemandLead')]: LeadStage.NETWORK_DEFERRED_DEMAND,
      [t('leadsBlock.agreement')]: LeadStage.NETWORK_AGREEMENT,
      [t('leadsBlock.formFilled')]: LeadStage.NETWORK_FORM_FILLED,
      [t('leadsBlock.lkRegistration')]: LeadStage.NETWORK_ACCOUNT_REGISTERED,
      [t('leadsBlock.offerSigned')]: LeadStage.NETWORK_OFFER_SIGNED,
      [t('leadsBlock.workStarted')]: LeadStage.NETWORK_WORK_STARTED,
    },
    Owner: {
      [t('leadsBlock.defectiveContact')]: LeadStage.OWNER_REJECTED_DEFECTIVE,
      [t('leadsBlock.ownerRefusal')]: LeadStage.OWNER_REJECTED_OWNER,
      [t('leadsBlock.noAnswerOwner3')]: LeadStage.OWNER_NO_CALL_3,
      [t('leadsBlock.noAnswerOwner2')]: LeadStage.OWNER_NO_CALL_2,
      [t('leadsBlock.noAnswerOwner1')]: LeadStage.OWNER_NO_CALL_1,
      [t('leadsBlock.newOwner')]: LeadStage.OWNER_NEW_OWNER,
      [t('leadsBlock.callbackLater')]: LeadStage.OWNER_CALL_LATER,
      [t('leadsBlock.presentedCompany')]: LeadStage.OWNER_COMPANY_PRESENTED,
      [t('leadsBlock.discussedProperty')]: LeadStage.OWNER_OBJECT_DISCUSSED,
      [t('leadsBlock.offeredPhotoshoot')]: LeadStage.OWNER_PHOTO_PROPOSED,
      [t('leadsBlock.offeredExclusive')]: LeadStage.OWNER_EXCLUSIVE_PROPOSED,
      [t('leadsBlock.handledObjections')]: LeadStage.OWNER_OBJECTIONS,
      [t('leadsBlock.agreedCooperation')]: LeadStage.OWNER_AGREED,
      [t('leadsBlock.propertyActive')]: LeadStage.OWNER_ACTIVE_FOR_SALE,
      [t('leadsBlock.takeRecommendation')]: LeadStage.OWNER_GET_REFERRAL,
      [t('leadsBlock.learnNewProperty')]: LeadStage.OWNER_NEW_OBJECT_INQUIRY,
    },
    Agent: {
      [t('leadsBlock.defectiveContact')]: LeadStage.AGENT_REJECTED_DEFECTIVE,
      [t('leadsBlock.reject')]: LeadStage.AGENT_REJECTED,
      [t('leadsBlock.noAnswerOwner3')]: LeadStage.AGENT_NO_CALL_3,
      [t('leadsBlock.noAnswerOwner2')]: LeadStage.AGENT_NO_CALL_2,
      [t('leadsBlock.noAnswerOwner1')]: LeadStage.AGENT_NO_CALL_1,
      [t('leadsBlock.newBroker')]: LeadStage.AGENT_NEW_AGENT,
      [t('leadsBlock.callbackLater')]: LeadStage.AGENT_CALL_LATER,
      [t('leadsBlock.presentedCompany')]: LeadStage.AGENT_COMPANY_PRESENTED,
      [t('leadsBlock.cooperationFormat')]: LeadStage.AGENT_FORMAT,
      [t('leadsBlock.objectionsHandling')]: LeadStage.AGENT_OBJECTIONS,
      [t('leadsBlock.agreedToCooperate')]: LeadStage.AGENT_AGREED,
      [t('leadsBlock.activeBroker')]: LeadStage.AGENT_ACTIVE,
    },
  };


  const allStatusLabels = useMemo(() => {
    const allProperties: string[] = [];
    const hasBought = selectedProduct === 'RP';
    const categories: ('leads' | 'inWork' | 'bought')[] = hasBought ? ['leads', 'inWork', 'bought'] : ['leads', 'inWork'];
    categories.forEach(category => {
      if (!hasBought && category === 'bought') return;
      const productProps = funnelProperties[selectedProduct];
      if (category in productProps) {
        allProperties.push(...(productProps[category as keyof typeof productProps] as string[]));
      }
    });
    return allProperties;
  }, [selectedProduct, funnelProperties]);

  const statusLabels = useMemo(() => {
    // В grid режиме всегда показываем все статусы из всех категорий
    if (selectedTab === 'all' || viewMode === 'list' || viewMode === 'grid') {
      return allStatusLabels;
    }
    const productProps = funnelProperties[selectedProduct];
    if (selectedTab in productProps) {
      return productProps[selectedTab as keyof typeof productProps] as string[];
    }
    return [];
  }, [selectedProduct, selectedTab, viewMode, allStatusLabels, funnelProperties]);

  const stageOptions = useMemo(() => {
    const allStages: string[] = [];
    const hasBought = selectedProduct === 'RP';
    const categories: ('leads' | 'inWork' | 'bought')[] = hasBought ? ['leads', 'inWork', 'bought'] : ['leads', 'inWork'];
    categories.forEach(category => {
      if (!hasBought && category === 'bought') return;
      const productProps = funnelProperties[selectedProduct];
      if (category in productProps) {
        allStages.push(...(productProps[category as keyof typeof productProps] as string[]));
      }
    });
    return Array.from(new Set(allStages));
  }, [selectedProduct, funnelProperties]);

  const allStatusStages = useMemo(() => {
    const stageMap = statusToLeadStageMap[selectedProduct];
    return allStatusLabels.map((status) => stageMap[status]).filter(Boolean);
  }, [allStatusLabels, selectedProduct, statusToLeadStageMap]);

  const statusStages = useMemo(() => {
    const stageMap = statusToLeadStageMap[selectedProduct];
    return statusLabels.map((status) => stageMap[status]).filter(Boolean);
  }, [selectedProduct, statusLabels, statusToLeadStageMap]);

  const positionToStageMap = useMemo(() => {
    const map: Record<number, LeadStage> = {};
    statusStages.forEach((stage, index) => {
      map[index + 1] = stage;
    });
    return map;
  }, [statusStages]);

  const productTypeToTab: Partial<Record<ProductType, ProductTab>> = {
    [ProductType.SALES]: 'RP',
    [ProductType.NETWORK]: 'Net',
    [ProductType.OWNER]: 'Owner',
    [ProductType.AGENT]: 'Agent',
  };

  const getStageLabel = useCallback((stage: LeadStage, productType: ProductType): string => {
    const product = productTypeToTab[productType] || 'RP';
    const stageMap = statusToLeadStageMap[product];
    
    for (const [label, stageValue] of Object.entries(stageMap)) {
      if (stageValue === stage) {
        return label;
      }
    }
    return stage;
  }, [statusToLeadStageMap]);

  const getStatusCategory = useCallback((status: string): 'leads' | 'inWork' | 'bought' | null => {
    const productProps = funnelProperties[selectedProduct];
    for (const [category, statuses] of Object.entries(productProps)) {
      if (statuses.includes(status)) {
        return category as 'leads' | 'inWork' | 'bought';
      }
    }
    return null;
  }, [selectedProduct, funnelProperties]);

  const tabButtonRefs = {
    all: useRef<HTMLButtonElement>(null),
    leads: useRef<HTMLButtonElement>(null),
    inWork: useRef<HTMLButtonElement>(null),
    bought: useRef<HTMLButtonElement>(null),
  };

  const transformLeadToRecord = (lead: Lead): LeadRecord => {

    const stageToCategory: Record<LeadStage, 'leads' | 'inWork' | 'bought'> = {
      [LeadStage.FIRST_CONTACT]: 'leads',
      [LeadStage.QUALIFICATION]: 'leads',
      [LeadStage.NEEDS_ANALYSIS]: 'inWork',
      [LeadStage.PRESENTATION]: 'inWork',
      [LeadStage.PROPOSAL]: 'inWork',
      [LeadStage.NEGOTIATION]: 'inWork',
      [LeadStage.DECISION_MAKING]: 'inWork',
      [LeadStage.CONTRACT_SIGNING]: 'inWork',
      [LeadStage.ONBOARDING]: 'inWork',
      [LeadStage.DEAL_CLOSED]: 'bought',
      [LeadStage.POST_PURCHASE_FOLLOWUP]: 'bought',
      [LeadStage.SATISFACTION_CHECK]: 'bought',
      [LeadStage.UPSELL_OPPORTUNITY]: 'bought',
      [LeadStage.REJECTED]: 'leads',
      // Дополнительные стейджи для уникальности
      [LeadStage.REJECTED1]: 'leads',
      [LeadStage.FIRST_CONTACT1]: 'leads',
      [LeadStage.NEEDS_ANALYSIS1]: 'inWork',
      [LeadStage.PRESENTATION1]: 'inWork',
      [LeadStage.PROPOSAL1]: 'inWork',
      [LeadStage.NEGOTIATION1]: 'inWork',
      [LeadStage.DECISION_MAKING1]: 'inWork',
      [LeadStage.CONTRACT_SIGNING1]: 'inWork',
      // Дополнительные специфичные этапы
      [LeadStage.REGISTERED]: 'inWork',
      [LeadStage.ADAPTED]: 'inWork',
      // NETWORK этапы - Отказ
      [LeadStage.NETWORK_REJECTED_DEFECTIVE]: 'leads',
      [LeadStage.NETWORK_REJECTED]: 'leads',
      [LeadStage.NETWORK_NO_CALL_3]: 'leads',
      [LeadStage.NETWORK_NO_CALL_2]: 'leads',
      [LeadStage.NETWORK_NO_CALL_1]: 'leads',
      // NETWORK этапы - В работе
      [LeadStage.NETWORK_NEW_LEAD]: 'inWork',
      [LeadStage.NETWORK_CALL_LATER]: 'inWork',
      [LeadStage.NETWORK_COMPANY_PRESENTED]: 'inWork',
      [LeadStage.NETWORK_PLATFORM_PRESENTED]: 'inWork',
      [LeadStage.NETWORK_OFFER_GIVEN]: 'inWork',
      [LeadStage.NETWORK_OBJECTIONS]: 'inWork',
      [LeadStage.NETWORK_DEFERRED_DEMAND]: 'inWork',
      [LeadStage.NETWORK_AGREEMENT]: 'inWork',
      [LeadStage.NETWORK_FORM_FILLED]: 'inWork',
      [LeadStage.NETWORK_ACCOUNT_REGISTERED]: 'inWork',
      [LeadStage.NETWORK_OFFER_SIGNED]: 'inWork',
      [LeadStage.NETWORK_WORK_STARTED]: 'inWork',
      // NETWORK этапы - Риелтор
      [LeadStage.REALTOR_1]: 'inWork',
      [LeadStage.REALTOR_2]: 'inWork',
      [LeadStage.REALTOR_3]: 'inWork',
      [LeadStage.REALTOR_4]: 'inWork',
      [LeadStage.REALTOR_5]: 'inWork',
      [LeadStage.REALTOR_6]: 'inWork',
      // NETWORK этапы - Куратор
      [LeadStage.CURATOR_1]: 'inWork',
      [LeadStage.CURATOR_2]: 'inWork',
      [LeadStage.CURATOR_3]: 'inWork',
      [LeadStage.CURATOR_4]: 'inWork',
      [LeadStage.CURATOR_5]: 'inWork',
      [LeadStage.CURATOR_6]: 'inWork',
      [LeadStage.OWNER_REJECTED_DEFECTIVE]: 'leads',
      [LeadStage.OWNER_REJECTED_OWNER]: 'leads',
      [LeadStage.OWNER_NO_CALL_3]: 'leads',
      [LeadStage.OWNER_NO_CALL_2]: 'leads',
      [LeadStage.OWNER_NO_CALL_1]: 'leads',
      [LeadStage.OWNER_NEW_OWNER]: 'inWork',
      [LeadStage.OWNER_CALL_LATER]: 'inWork',
      [LeadStage.OWNER_COMPANY_PRESENTED]: 'inWork',
      [LeadStage.OWNER_OBJECT_DISCUSSED]: 'inWork',
      [LeadStage.OWNER_PHOTO_PROPOSED]: 'inWork',
      [LeadStage.OWNER_EXCLUSIVE_PROPOSED]: 'inWork',
      [LeadStage.OWNER_OBJECTIONS]: 'inWork',
      [LeadStage.OWNER_AGREED]: 'inWork',
      [LeadStage.OWNER_ACTIVE_FOR_SALE]: 'inWork',
      [LeadStage.OWNER_GET_REFERRAL]: 'inWork',
      [LeadStage.OWNER_NEW_OBJECT_INQUIRY]: 'inWork',
      [LeadStage.AGENT_REJECTED_DEFECTIVE]: 'leads',
      [LeadStage.AGENT_REJECTED]: 'leads',
      [LeadStage.AGENT_NO_CALL_3]: 'leads',
      [LeadStage.AGENT_NO_CALL_2]: 'leads',
      [LeadStage.AGENT_NO_CALL_1]: 'leads',
      [LeadStage.AGENT_NEW_AGENT]: 'inWork',
      [LeadStage.AGENT_CALL_LATER]: 'inWork',
      [LeadStage.AGENT_COMPANY_PRESENTED]: 'inWork',
      [LeadStage.AGENT_FORMAT]: 'inWork',
      [LeadStage.AGENT_OBJECTIONS]: 'inWork',
      [LeadStage.AGENT_AGREED]: 'inWork',
      [LeadStage.AGENT_ACTIVE]: 'inWork'
    };

    let city = t('leadsBlock.batumi');
    
    if ('city' in lead && (lead as any).city) {
      city = (lead as any).city;
    } else if (lead.notes) {
      const cityMatch = lead.notes.match(/Город:\s*(.+)/);
      if (cityMatch) {
        city = cityMatch[1].trim();
      }
    }

    return {
      id: lead._id,
      imageUrl: 'https://media.tenor.com/oH4rR8zugF8AAAAe/%D0%B3%D0%B0%D1%82%D1%81-%D0%B1%D0%B5%D1%80%D1%81%D0%B5%D1%80%D0%BA.png',
      name: lead.name,
      date: new Date(lead.createdAt).toLocaleDateString('ru-RU'),
      type: productTypeToTab[lead.productType] || 'RP',
      city: city,
      category: stageToCategory[lead.stage] || 'leads',
      stageLabel: getStageLabel(lead.stage, lead.productType),
      budgetValue: lead.budgetValue,
      tags: lead.tags?.slice(0, 2) ?? [],
    };
  };

  // Пересчитываем leadRecords с учетом текущих позиций ползунков
  // Функция для закрепления/открепления лида
  const togglePinLead = useCallback((leadId: string) => {
    setPinnedLeadId(prev => {
      if (prev === leadId) {
        // Открепляем текущий лид
        localStorage.removeItem('pinnedLeadId');
        return null;
      } else {
        // Закрепляем новый лид (предыдущий автоматически открепляется)
        localStorage.setItem('pinnedLeadId', leadId);
        return leadId;
      }
    });
  }, []);

  // Категория определяется на основе текущего статуса из позиции ползунка, а не из lead.stage
  const leadRecords: LeadRecord[] = useMemo(() => {


    // Объединяем моковый лид с лидами из API
    const allLeads = [...backendLeads];

    const records = allLeads.map((lead, index) => {
      const record = transformLeadToRecord(lead);
      record.backendIndex = index;
      record.stage = lead.stage;
      record.stageLabel = getStageLabel(lead.stage, lead.productType);
      record.createdAt = lead.createdAt;
      record.updatedAt = lead.updatedAt;
      record.productType = lead.productType;
      
      // Если есть позиция ползунка для этой записи, определяем категорию на основе текущего статуса
      const position = sliderPositions[record.id];
      if (position !== undefined) {
        const statusList = viewMode === 'list' ? allStatusLabels : statusLabels;
        const currentStatus = statusList[position - 1];
        if (currentStatus) {
          const categoryFromStatus = getStatusCategory(currentStatus);
          if (categoryFromStatus) {
            record.category = categoryFromStatus;
          }
        }
      }
      
      return record;
    });

    return records.sort((a, b) => compareLeadListOrder(a, b, pinnedLeadId));
  }, [backendLeads, sliderPositions, viewMode, allStatusLabels, statusLabels, getStatusCategory, getStageLabel, pinnedLeadId]);


  const filteredLeadRecords = useMemo(() => {
    const minBudgetValue = minBudget ? Number(minBudget) : null;
    const maxBudgetValue = maxBudget ? Number(maxBudget) : null;
    const searchLower = searchQuery.trim().toLowerCase();

    return leadRecords.filter(record => {
      // Фильтрация по поисковому запросу (ФИО и теги)
      if (searchLower) {
        const leadName = record.name?.toLowerCase() || '';
        const tagMatch = (record.tags ?? []).some((tag) => tag.toLowerCase().includes(searchLower));
        if (!leadName.includes(searchLower) && !tagMatch) {
          return false;
        }
      }

      // Фильтр по типу воронки (этапу)
      if (selectedStages.length > 0 && !selectedStages.includes(record.stageLabel)) {
        return false;
      }

      // Фильтр по бюджету
      if (minBudgetValue !== null || maxBudgetValue !== null) {
        const budget = typeof record.budgetValue === 'number' ? record.budgetValue : null;
        if (budget === null) {
          return false;
        }
        if (minBudgetValue !== null && budget < minBudgetValue) {
          return false;
        }
        if (maxBudgetValue !== null && budget > maxBudgetValue) {
          return false;
        }
      }

      return true;
    });
  }, [
    leadRecords,
    searchQuery,
    selectedStages,
    minBudget,
    maxBudget,
  ]);

  const getPositionFromLeadStage = useCallback((lead: Lead): number => {
    const index = statusStages.findIndex(stage => stage === lead.stage);
    return index >= 0 ? index + 1 : 1;
  }, [statusStages]);

  const filteredLeadsForProduct = useMemo(() => {
    return filteredLeadRecords.filter(record => record.type === selectedProduct);
  }, [filteredLeadRecords, selectedProduct]);

  const categoryCounts = useMemo(() => {
    return {
      all: filteredLeadsForProduct.length,
      leads: filteredLeadsForProduct.filter(record => record.category === 'leads').length,
      inWork: filteredLeadsForProduct.filter(record => record.category === 'inWork').length,
      bought: filteredLeadsForProduct.filter(record => record.category === 'bought').length,
    };
  }, [filteredLeadsForProduct]);

  const calculatedColumnWidth = useMemo(() => {
    // 0 = 200px, 50 = 300px, 100 = 400px
    const minWidth = 180;
    const maxWidth = 400;
    return minWidth + (columnWidth / 100) * (maxWidth - minWidth);
  }, [columnWidth]);

  const calculatedFontSize = useMemo(() => {
    // 0 = 0.75rem (12px), 50 = 0.875rem (14px), 100 = 1rem (16px)
    const minSize = 1; // 12px
    const maxSize = 2; // 16px
    return minSize + (fontSize / 100) * (maxSize - minSize);
  }, [fontSize]);

  // Восстановление состояния лида из URL при загрузке
  // Ref для отслеживания последнего открытого лида из URL, чтобы избежать повторных открытий
  const lastOpenedLeadIdRef = useRef<string | null>(null);
  
  useEffect(() => {
    const leadIdParam = searchParams.get('leadId');
    const modalParam = searchParams.get('modal');
    
    // Проверяем, что в URL нет модалки задачи одновременно с модалкой лида
    const hasTaskModal = modalParam === 'task' && searchParams.get('taskId');
    
    if (modalParam === 'lead' && leadIdParam && !hasTaskModal) {
      // Проверяем, что модалка еще не открыта для этого лида
      // Используем lastOpenedLeadIdRef для более надежной проверки
      const isAlreadyOpen = lastOpenedLeadIdRef.current === leadIdParam && 
                           isLeadViewModalOpen && 
                           selectedLead?._id === leadIdParam;
      
      // Проверяем глобальный флаг, чтобы предотвратить двойное открытие при рендеринге двух экземпляров LeadsBlock
      const globalOpeningKey = `leadModalOpening_${leadIdParam}`;
      const isBeingOpened = typeof window !== 'undefined' && (window as any)[globalOpeningKey] === true;
      
      // Если модалка уже открыта для этого лида или открывается другим экземпляром, просто выходим
      if (isAlreadyOpen || isBeingOpened) {
        return;
      }
      
      // Сначала пытаемся найти лид в загруженных лидах
      const foundLead = backendLeads.find(l => l._id === leadIdParam);
      
      if (foundLead) {
        // Лид найден в загруженных данных
        if (!selectedLead || selectedLead._id !== leadIdParam) {
          // Устанавливаем глобальный флаг ДО открытия модалки, чтобы предотвратить двойное открытие
          const globalOpeningKey = `leadModalOpening_${leadIdParam}`;
          if (typeof window !== 'undefined') {
            (window as any)[globalOpeningKey] = true;
          }
          lastOpenedLeadIdRef.current = leadIdParam;
          setSelectedLead(foundLead);
          setIsLeadViewModalOpen(true);
          // Сбрасываем глобальный флаг после небольшой задержки
          setTimeout(() => {
            if (typeof window !== 'undefined') {
              delete (window as any)[globalOpeningKey];
            }
          }, 200);
          // Закрываем чеклист при открытии карточки лида
          if (onCloseChecklist) {
            onCloseChecklist();
          }
          // Закрываем модалку задачи, если она открыта
          const newParams = new URLSearchParams(searchParams);
          if (newParams.get('modal') === 'task') {
            newParams.delete('modal');
            newParams.delete('taskId');
            newParams.delete('editing');
            setSearchParams(newParams, { replace: true });
          }
        }
      } else if (!selectedLead || selectedLead._id !== leadIdParam) {
        // Лид не найден в загруженных данных, загружаем из API
        const loadLeadFromAPI = async () => {
          try {
            const leadV2 = await leadsApiV2.getById(leadIdParam);
            const mappedLead = mapLeadV2ToCrmLead(leadV2);
            {
              // Устанавливаем глобальный флаг ДО открытия модалки, чтобы предотвратить двойное открытие
              const globalOpeningKey = `leadModalOpening_${leadIdParam}`;
              if (typeof window !== 'undefined') {
                (window as any)[globalOpeningKey] = true;
              }
              lastOpenedLeadIdRef.current = leadIdParam;
              setSelectedLead(mappedLead);
              setIsLeadViewModalOpen(true);
              // Сбрасываем глобальный флаг после небольшой задержки
              setTimeout(() => {
                if (typeof window !== 'undefined') {
                  delete (window as any)[globalOpeningKey];
                }
              }, 200);
              // Закрываем чеклист при открытии карточки лида
              if (onCloseChecklist) {
                onCloseChecklist();
              }
              // Закрываем модалку задачи, если она открыта
              const newParams = new URLSearchParams(searchParams);
              if (newParams.get('modal') === 'task') {
                newParams.delete('modal');
                newParams.delete('taskId');
                newParams.delete('editing');
                setSearchParams(newParams, { replace: true });
              }
              // Обновляем список лидов, чтобы новый лид появился в списке
              await onLoadLeads();
            }
          } catch (error) {
            console.error('Error loading lead from URL:', error);
            // Очищаем URL параметры при ошибке
            const newParams = new URLSearchParams(searchParams);
            newParams.delete('modal');
            newParams.delete('leadId');
            newParams.delete('tab');
            newParams.delete('editing');
            setSearchParams(newParams, { replace: true });
            lastOpenedLeadIdRef.current = null;
          }
        };
        
        loadLeadFromAPI();
      }
    } else if (modalParam !== 'lead' && isLeadViewModalOpen) {
      // Если в URL нет параметра modal=lead, но модалка открыта, закрываем её
      // Но только если это не временное обновление (например, при переключении вкладок)
      if (lastOpenedLeadIdRef.current) {
        setIsLeadViewModalOpen(false);
        setSelectedLead(null);
        setInitialTab('history');
        lastOpenedLeadIdRef.current = null;
      }
    }
  }, [searchParams, backendLeads, selectedLead, isLeadViewModalOpen, onLoadLeads, setSearchParams, onCloseChecklist]);

  useEffect(() => {
    setSliderPositions(prev => {
      const newPositions: { [key: string]: number } = {};
      let hasChanges = false;

      backendLeads.forEach(lead => {
        const currentPosition = prev[lead._id];
        const position = getPositionFromLeadStage(lead);
        
        if (currentPosition !== position) {
          newPositions[lead._id] = position;
          hasChanges = true;
        } else {
          newPositions[lead._id] = currentPosition || position;
        }
      });

      return hasChanges ? { ...prev, ...newPositions } : prev;
    });
  }, [backendLeads, getPositionFromLeadStage]);

  // Функция для показа overlay с чеклистом
  const showChecklistOverlay = useCallback((leadId: string) => {
    if (!showChecklist) return;
    const lead = backendLeads.find(l => l._id === leadId);
    if (!lead) {
      console.warn('[showChecklistOverlay] Лид не найден:', leadId, t('leadsBlock.totalLeads'), backendLeads.length);
      return;
    }
    if (!onLeadStageChange) {
      console.warn('[showChecklistOverlay] onLeadStageChange не определен');
      return;
    }

    // Переключаем воронку на воронку лида ПЕРЕД открытием чеклиста
    // Это предотвратит закрытие чеклиста из-за несоответствия воронок
    const leadProduct = productTypeToTab[lead.productType] || 'RP';
    
    setSelectedProduct(leadProduct);
    
    const stageLabel = getStageLabel(lead.stage, lead.productType);
    onLeadStageChange(leadId, lead.name, stageLabel, lead.stage, lead.productType);
  }, [backendLeads, onLeadStageChange, getStageLabel, showChecklist]);

  const updateLeadStage = async (leadId: string, position: number) => {
    // В построчном режиме используем allStatusStages, иначе statusStages.
    const statusList = viewMode === 'list' ? allStatusLabels : statusLabels;
    const stageList = viewMode === 'list' ? allStatusStages : statusStages;
    const status = statusList[position - 1];
    const stage = stageList[position - 1];
    if (!stage) {
      console.warn('Invalid position for stage:', position, 'stageList length:', stageList.length);
      return;
    }

    const lead = backendLeads.find(l => l._id === leadId);
    if (!lead) {
      console.warn('Lead not found:', leadId);
      return;
    }

    // Сохраняем старый этап для логирования
    const oldStage = lead.stage;
    const oldStageLabel = getStageLabel(oldStage, lead.productType);

    const newStageLabel = getStageLabel(stage, lead.productType);


    // Обновляем локальные данные через leadSync
    // Используем updateLead для отслеживания изменений пользователем (устанавливает блокировку на 3 секунды)
    if (onUpdateLead) {
      onUpdateLead(leadId, { stage }, ['stage']);
    } else {
      // Fallback: используем старый способ, если onUpdateLead не передан
      const updatedLead = { ...lead, stage };
      const updatedLeads = backendLeads.map(l => l._id === leadId ? updatedLead : l);
      onUpdateLeads(updatedLeads);
    }

    try {
      // `[phase 4]` CAS через expectedVersion — тот же паттерн, что
      // LeadsContext/LeadViewModal (см. leadsApiV2.changeStage докстринг).
      // `(lead as any).version` — расширение mapLeadV2ToCrmLead под CAS в
      // этом компоненте (см. lead-v2-legacy-adapter.ts докстринг поля).
      const expectedVersion = (lead as any).version ?? 0;
      await leadsApiV2.changeStage(leadId, stageCrmToV2(stage), expectedVersion, newIdempotencyKey());

      // changeStage не отдаёт полную read-модель лида (см. её докстринг) —
      // перечитываем лид, чтобы получить актуальные name/productType/version
      // для onLeadStageChange/onUpdateLeadAfterSync (тот же приём, что
      // LeadViewModal.handleNetworkStageChange).
      const leadV2 = await leadsApiV2.getById(leadId);
      const mappedLead = mapLeadV2ToCrmLead(leadV2);
      const currentStage = mappedLead.stage;
      const currentStageLabel = getStageLabel(currentStage, mappedLead.productType);

      // Уведомляем родительский компонент о изменении этапа для отображения overlay
      if (onLeadStageChange) {
        onLeadStageChange(mappedLead._id, mappedLead.name, currentStageLabel, currentStage, mappedLead.productType);
      }

      // Обновляем данные лида с сервера после успешной синхронизации
      // Блокировка на 3 секунды сохраняется, чтобы предотвратить перезапись автообновлением
      if (onUpdateLeadAfterSync) {
        onUpdateLeadAfterSync(leadId, mappedLead);
      }
    } catch (error: any) {
      console.error('Error updating lead stage:', {
        error,
        message: error?.message,
        response: error?.response?.data,
        stage,
        leadId
      });
      if (error?.response?.status === 409) {
        console.warn('Стадию лида изменил кто-то ещё (VERSION_CONFLICT) — перечитываем данные:', leadId);
      } else if (error?.response?.data?.message?.includes('stage') || error?.response?.status === 400) {
        console.warn('API rejected the stage update. The backend may not support this stage:', stage);
      }
      await onLoadLeads();
    }
  };


  const updateSliderPosition = async (recordId: string, position: number) => {
    const record = leadRecords.find(r => r.id === recordId);
    if (!record) {
      return;
    }

    // В построчном и grid режимах используем allStatusLabels для определения статуса
    // В grid режиме показываются все статусы из всех категорий
    const statusList = (viewMode === 'list' || viewMode === 'grid') ? allStatusLabels : statusLabels;
    const currentStatus = statusList[position - 1];
    if (!currentStatus) {
      return;
    }
    const newCategory = getStatusCategory(currentStatus);
    
    // Определяем старую категорию на основе текущей позиции ползунка (до обновления)
    // Важно использовать тот же statusList для определения старой категории
    const oldPosition = sliderPositions[recordId];
    let oldCategory: 'leads' | 'inWork' | 'bought' | undefined = record.category;
    
    
    // Если есть старая позиция, определяем категорию на основе старого статуса
    if (oldPosition !== undefined && oldPosition > 0 && oldPosition <= statusList.length) {
      const oldStatus = statusList[oldPosition - 1];
      if (oldStatus) {
        const categoryFromOldStatus = getStatusCategory(oldStatus);
        if (categoryFromOldStatus) {
          oldCategory = categoryFromOldStatus;
        }
      }
    } else {
      // Если позиции нет или она некорректна, используем категорию из record (определенную на основе lead.stage)
      oldCategory = record.category;
    }

    // Если карточка переходит в другую категорию и мы не в режиме t('leadsBlock.all'), добавляем анимацию исчезновения
    if (selectedTab !== 'all' && newCategory && oldCategory && newCategory !== oldCategory) {
      // Проверяем, что карточка видна в текущей категории (старая категория совпадает с selectedTab)
      const isCardVisibleInCurrentTab = oldCategory === selectedTab;
      
      if (isCardVisibleInCurrentTab) {
        // Определяем направление свайпа на основе позиции категорий
        // Свайп направлен в сторону новой категории, которая принимает карточку
        const categoryOrder: ('leads' | 'inWork' | 'bought')[] = ['leads', 'inWork', 'bought'];
        const oldIndex = categoryOrder.indexOf(oldCategory);
        const newIndex = categoryOrder.indexOf(newCategory);
        // Если новая категория правее (больше индекса) - свайп вправо, иначе влево
        const swipeDirection = newIndex > oldIndex ? 'right' : 'left';
        
        
        // Сохраняем старую позицию для анимации (чтобы карточка оставалась в старом столбце во время анимации)
        setAnimationOldPositions(prev => ({ ...prev, [recordId]: oldPosition || 1 }));
        
        // Устанавливаем анимацию СРАЗУ, до обновления позиции
        setCardSwipeDirections(prev => ({ ...prev, [recordId]: swipeDirection }));
        setDisappearingCards(prev => new Set(prev).add(recordId));
        
        // Удаляем карточку из списка исчезающих после анимации
        setTimeout(() => {
          setDisappearingCards(prev => {
            const newSet = new Set(prev);
            newSet.delete(recordId);
            return newSet;
          });
          setCardSwipeDirections(prev => {
            const newDirs = { ...prev };
            delete newDirs[recordId];
            return newDirs;
          });
          setAnimationOldPositions(prev => {
            const newPositions = { ...prev };
            delete newPositions[recordId];
            return newPositions;
          });
        }, 300);
      } else {
      }
    } else {
    }

    // Обновляем позицию ПОСЛЕ установки анимации
    setSliderPositions(prev => ({ ...prev, [recordId]: position }));

    try {

      await updateLeadStage(recordId, position);
    } catch (error) {
      console.error('Failed to update lead stage on backend:', error);

      const backendLead = backendLeads.find(lead => lead._id === recordId);
      if (backendLead) {
        const originalPosition = getPositionFromLeadStage(backendLead);
        setSliderPositions(prev => ({ ...prev, [recordId]: originalPosition }));
      }
    }
  };

  const handleDragOver = (e: React.DragEvent, statusIndex: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDraggedOverColumn(statusIndex);
  };

  const handleDragLeave = () => {
    setDraggedOverColumn(null);
  };

  const handleDrop = (e: React.DragEvent, targetStatusIndex: number) => {
    e.preventDefault();
    setDraggedOverColumn(null);
    const recordId = e.dataTransfer.getData('text/plain');
    if (recordId) {
      updateSliderPosition(recordId, targetStatusIndex + 1);
    }
  };

  const updatePositions = useCallback(() => {
    const positions: { [key: string]: { left: number; width: number } } = {};
    const container = tabButtonRefs.all.current?.parentElement;
    if (!container) return;

    const containerStyles = window.getComputedStyle(container);
    const borderLeft = parseFloat(containerStyles.borderLeftWidth) || 0;
    const containerRect = container.getBoundingClientRect();

    Object.entries(tabButtonRefs).forEach(([key, ref]) => {
      // Пропускаем кнопку 'bought', если она скрыта
      if (key === 'bought' && selectedProduct !== 'RP') {
        return;
      }

      if (ref.current) {
        // Проверяем, что кнопка действительно видна в DOM и имеет размеры
        const buttonRect = ref.current.getBoundingClientRect();
        // Пропускаем элементы, которые не видны или имеют нулевые размеры
        if (buttonRect.width === 0 || buttonRect.height === 0) {
          return;
        }
        
        const relativeLeft = buttonRect.left - containerRect.left - borderLeft;

        positions[key] = {
          left: relativeLeft,
          width: buttonRect.width,
        };
      }
    });
    setButtonPositions(positions);

  }, [selectedProduct]);

  const handleTabChange = useCallback((tab: 'all' | 'leads' | 'inWork' | 'bought') => {
    setSelectedTab(tab);
    // Пересчитываем позиции после переключения таба для корректного отображения индикатора
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        updatePositions();
      });
    });
  }, [updatePositions]);

  useEffect(() => {
    const rafId = requestAnimationFrame(() => {
      updatePositions();
    });
    return () => cancelAnimationFrame(rafId);
  }, [updatePositions]);

  useEffect(() => {
    // Используем двойной requestAnimationFrame для гарантии обновления layout
    let rafId1: number;
    let rafId2: number;
    let timeoutId: ReturnType<typeof setTimeout>;
    
    rafId1 = requestAnimationFrame(() => {
      rafId2 = requestAnimationFrame(() => {
        updatePositions();
        // Дополнительная проверка через небольшую задержку для корректного расчета позиций после появления/исчезновения кнопок
        timeoutId = setTimeout(() => {
          updatePositions();
        }, 50);
      });
    });
    
    window.addEventListener('resize', updatePositions);
    return () => {
      if (rafId1) cancelAnimationFrame(rafId1);
      if (rafId2) cancelAnimationFrame(rafId2);
      if (timeoutId) clearTimeout(timeoutId);
      window.removeEventListener('resize', updatePositions);
    };
  }, [selectedTab, selectedProduct, updatePositions]);

  useEffect(() => {
    if (selectedProduct !== 'RP' && selectedTab === 'bought') {
      setSelectedTab('all');
    }
  }, [selectedProduct, selectedTab, viewMode, funnelProperties, t]);

  // Уведомляем родительский компонент об изменении продукта
  useEffect(() => {
    if (onProductChange) {
      onProductChange(selectedProduct);
    }
  }, [selectedProduct, onProductChange]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        isSizeMenuOpen &&
        sizeMenuRef.current &&
        sizeMenuButtonRef.current &&
        !sizeMenuRef.current.contains(event.target as Node) &&
        !sizeMenuButtonRef.current.contains(event.target as Node)
      ) {
        setIsSizeMenuOpen(false);
      }
    };

    if (isSizeMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isSizeMenuOpen]);

  const toggleStage = (stage: string) => {
    setSelectedStages(prev => 
      prev.includes(stage) 
        ? prev.filter(s => s !== stage)
        : [...prev, stage]
    );
  };

  // Функция удалена, так как не используется
  // const _toggleRegion = (region: string) => {
  //   _setSelectedRegions(prev => 
  //     prev.includes(region) 
  //       ? prev.filter(r => r !== region)
  //       : [...prev, region]
  //   );
  // };

  // Закомментировано, так как не используется
  // const _formatDate = (dateString: string): string => {
  //   if (!dateString) return '';
  //   const date = new Date(dateString);
  //   const day = String(date.getDate()).padStart(2, '0');
  //   const month = String(date.getMonth() + 1).padStart(2, '0');
  //   const year = date.getFullYear();
  //   return `${day}.${month}.${year}`;
  // };

  // Закрытие календаря и меню контактов при клике вне их
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (isDatePickerOpen && !target.closest('[data-date-picker-container]')) {
        setIsDatePickerOpen(false);
      }
      // Закрытие меню контактов при клике вне его
      if (openContactMenu) {
        // Проверяем, что клик не был на кнопке открытия меню или внутри меню
        const isClickOnButton = target.closest('button')?.closest('.relative');
        const isClickInMenu = contactMenuRef.current?.contains(target);
        if (!isClickOnButton && !isClickInMenu) {
          setOpenContactMenu(null);
        }
      }
    };

    if (isDatePickerOpen || openContactMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isDatePickerOpen, openContactMenu]);

  const updateSliderValue = useCallback((clientX: number) => {
    if (!sliderTrackRef.current) return;
    
    const rect = sliderTrackRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
    if (viewMode === 'list') {
      setFontSize(percentage);
    } else {
      setColumnWidth(percentage);
    }
  }, [viewMode]);

  const handleSliderMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    updateSliderValue(e.clientX);
  }, [updateSliderValue]);

  const handleSliderTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    setIsDragging(true);
    if (e.touches[0]) {
      updateSliderValue(e.touches[0].clientX);
    }
  }, [updateSliderValue]);

  // Автосохранение настроек размера карточек и шрифта
  useEffect(() => {
    localStorage.setItem('leadsColumnWidth', columnWidth.toString());
  }, [columnWidth]);

  useEffect(() => {
    localStorage.setItem('leadsFontSize', fontSize.toString());
  }, [fontSize]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      updateSliderValue(e.clientX);
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches[0]) {
        updateSliderValue(e.touches[0].clientX);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    const handleTouchEnd = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isDragging, updateSliderValue]);

  const statusGroups = useMemo(() => {
    const groups: Array<{
      name: string;
      startIndex: number;
      endIndex: number;
      leftColor: string;
      rightColor: string;
    }> = [];
    
    let currentIndex = 0;
    
    // В построчном режиме всегда используем все категории
    if (selectedTab === 'all' || viewMode === 'list') {
      const hasBought = selectedProduct === 'RP';
      const categories: ('leads' | 'inWork' | 'bought')[] = hasBought ? ['leads', 'inWork', 'bought'] : ['leads', 'inWork'];
      
      categories.forEach((category) => {
        if (!hasBought && category === 'bought') return;
        const productProps = funnelProperties[selectedProduct];
        if (category in productProps) {
          const props = productProps[category as keyof typeof productProps] as string[];
          const endIndex = currentIndex + props.length - 1;
          
          const colors = category === 'leads' 
            ? { leftColor: 'rgb(204, 226, 244)', rightColor: 'rgb(53, 140, 210)' }
            : category === 'inWork'
            ? { leftColor: 'rgb(95, 190, 78)', rightColor: 'rgb(191, 229, 184)' }
            : { leftColor: 'rgb(255, 204, 0)', rightColor: 'rgb(255, 240, 179)' };
          
          groups.push({
            name: category === 'leads' ? [t('leadsBlock.reject')] : category === 'inWork' ? [t('leadsBlock.inProgress')] : t('leadsBlock.bought'),
            startIndex: currentIndex,
            endIndex: endIndex,
            ...colors
          });
          
          currentIndex = endIndex + 1;
        }
      });
    } else {
      const productProps = funnelProperties[selectedProduct];
      if (selectedTab in productProps) {
        const props = productProps[selectedTab as keyof typeof productProps] as string[];
        const colors = selectedTab === 'leads' 
          ? { leftColor: 'rgb(204, 226, 244)', rightColor: 'rgb(53, 140, 210)' }
          : selectedTab === 'inWork'
          ? { leftColor: 'rgb(95, 190, 78)', rightColor: 'rgb(191, 229, 184)' }
          : { leftColor: 'rgb(22, 150, 0)', rightColor: 'rgb(162, 213, 153)' };
        
        groups.push({
          name: selectedTab === 'leads' ? [t('leadsBlock.reject')] : selectedTab === 'inWork' ? [t('leadsBlock.inProgress')] : t('leadsBlock.bought'),
          startIndex: 0,
          endIndex: props.length - 1,
          ...colors
        });
      }
    }
    
    return groups;
  }, [selectedProduct, selectedTab]);

  // Функция для показа tooltip
  const showTooltip = (e: React.MouseEvent<HTMLElement>, text: string, tooltipId: string) => {
    const button = e.currentTarget;
    const rect = button.getBoundingClientRect();
    const margin = 8;
    
    // Создаем временный элемент для измерения ширины tooltip
    const tempDiv = document.createElement('div');
    tempDiv.style.position = 'absolute';
    tempDiv.style.visibility = 'hidden';
    tempDiv.style.whiteSpace = 'nowrap';
    tempDiv.style.padding = '6px 12px';
    tempDiv.style.fontSize = '12px';
    tempDiv.textContent = text;
    document.body.appendChild(tempDiv);
    const tooltipWidth = tempDiv.offsetWidth;
    const tooltipHeight = tempDiv.offsetHeight;
    document.body.removeChild(tempDiv);
    
    // Центрируем tooltip относительно кнопки
    let left = rect.left + rect.width / 2;
    let top = rect.top - tooltipHeight - margin;
    
    // Проверка выхода за правую границу
    if (left + tooltipWidth / 2 > window.innerWidth - 10) {
      left = window.innerWidth - tooltipWidth / 2 - 10;
    }
    // Проверка выхода за левую границу
    if (left - tooltipWidth / 2 < 10) {
      left = tooltipWidth / 2 + 10;
    }
    // Проверка выхода за верхнюю границу - показываем снизу
    if (top < 10) {
      top = rect.bottom + margin;
    }
    
    setActiveTooltip({
      id: tooltipId,
      text,
      position: { top, left }
    });
  };

  const hideTooltip = () => {
    setActiveTooltip(null);
  };

  const renderLeadRecord = (record: LeadRecord, isGridMode: boolean = false) => {
    const backendLead = backendLeads.find(lead => lead._id === record.id);

    let currentPosition = sliderPositions[record.id] || 1;
    if (backendLead) {
      const currentStage = positionToStageMap[currentPosition];
      if (currentStage) {
        if (currentStage !== backendLead.stage) {
          currentPosition = getPositionFromLeadStage(backendLead);
        }
      } else {
        currentPosition = getPositionFromLeadStage(backendLead);
      }
    }

    const handleCardClick = (e: React.MouseEvent) => {
      // Отключаем клик на мобильной версии
      if (window.innerWidth < 768) {
        return;
      }
      // Не открываем модалку при drag-and-drop или клике на интерактивные элементы
      if (dragStartMapRef.current.get(record.id) || isDragging || (e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('input') || (e.target as HTMLElement).closest('svg')) {
        dragStartMapRef.current.delete(record.id);
        return;
      }
      if (backendLead) {
        // Показываем чеклист при клике на карточку
        showChecklistOverlay(record.id);
      } else {
        console.warn('[handleCardClick] backendLead не найден для record.id:', record.id, t('leadsBlock.recordType'), record.type, 'selectedProduct:', selectedProduct);
      }
    };

    const handleCardDoubleClick = (e: React.MouseEvent) => {
      // Отключаем двойной клик на мобильной версии
      if (window.innerWidth < 768) {
        return;
      }
      // Не открываем модалку при клике на интерактивные элементы
      if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('input') || (e.target as HTMLElement).closest('svg') || (e.target as HTMLElement).closest('a')) {
        return;
      }
      // Открываем модальное окно с информацией о клиенте только в линейном режиме
      if (!isGridMode && backendLead) {
        e.stopPropagation();
        setInitialTab('history');
        // Обновляем URL параметры - модалка откроется через useEffect
        const newParams = new URLSearchParams(searchParams);
        newParams.set('modal', 'lead');
        newParams.set('leadId', backendLead._id);
        newParams.set('tab', 'history');
        setSearchParams(newParams, { replace: true });
        if (onCloseChecklist) {
          onCloseChecklist();
        }
      }
    };

    const isActiveLead = activeLeadId === record.id;
    const cardClasses = `relative bg-[var(--card)] rounded-md gap-3 md:gap-0 shadow-[inset_0_0_0_1px_rgba(201,168,76,0.1)] ${isGridMode ? 'p-3 md:cursor-pointer mb-3 shadow-sm md:hover:shadow-lg md:transition-all md:duration-300 md:ease-out md:hover:scale-[1.02] md:hover:-translate-y-0.5 h-28 flex flex-col' : 'flex items-center gap-x-4 px-5 py-0 flex-wrap md:cursor-pointer transition-all duration-300 ease-out hover:shadow-md hover:scale-[1.01]'} ${isActiveLead ? 'md:ring-2 md:ring-red-300 md:shadow-lg' : ''}`;

    return (
      <div
        className={cardClasses}
        style={{ overflow: 'visible' }}
        draggable={isGridMode}
        onClick={handleCardClick}
        onDoubleClick={handleCardDoubleClick}
        onDragStart={(e) => {
          if (isGridMode) {
            dragStartMapRef.current.set(record.id, true);
            e.dataTransfer.setData('text/plain', record.id);
            e.dataTransfer.effectAllowed = 'move';
            (e.target as HTMLElement).style.opacity = '0.5';
            // Показываем чеклист при начале drag-and-drop
            showChecklistOverlay(record.id);
          }
        }}
        onDragEnd={(e) => {
          (e.target as HTMLElement).style.opacity = '1';
          // Сбрасываем флаг через небольшую задержку, чтобы onClick не сработал
          setTimeout(() => {
            dragStartMapRef.current.delete(record.id);
          }, 100);
        }}
      >
        {isGridMode ? (
          <>
            <div className="flex flex-col items-center h-full justify-between">
              <div className="size-10 rounded-full overflow-hidden mb-3 hidden">
                <img
                  src={record.imageUrl}
                  alt={record.name}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="flex items-center justify-center w-full flex-wrap gap-1">
                <div className="relative">
                  <button 
                    className="px-1 rounded-md bg-[var(--secondary)] hover:bg-[color-mix(in_srgb,var(--primary)_14%,var(--secondary))] transition-all duration-200 ease-in-out cursor-pointer hover:scale-105 active:scale-95"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (backendLead) {
                        setInitialTab('info');
                        // Обновляем URL параметры - модалка откроется через useEffect
                        const newParams = new URLSearchParams(searchParams);
                        newParams.set('modal', 'lead');
                        newParams.set('leadId', backendLead._id);
                        newParams.set('tab', 'info');
                        setSearchParams(newParams, { replace: true });
                        if (onCloseChecklist) {
                          onCloseChecklist();
                        }
                      }
                    }}
                    onMouseEnter={(e) => showTooltip(e, record.type === 'Net' ? [t('leadsBlock.referralInfo')] : t('leadsBlock.clientInfo'), `${record.id}-info`)}
                    onMouseLeave={hideTooltip}
                  >
                    <svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M26.5625 3.75H3.4375C1.54125 3.75 0 5.29125 0 7.1875V22.8125C0 24.7087 1.54125 26.25 3.4375 26.25H26.5625C28.4587 26.25 30 24.7087 30 22.8125V7.1875C30 5.29125 28.4587 3.75 26.5625 3.75ZM9.375 8.75C11.0975 8.75 12.5 10.1525 12.5 11.875C12.5 13.5975 11.0975 15 9.375 15C7.6525 15 6.25 13.5975 6.25 11.875C6.25 10.1525 7.6525 8.75 9.375 8.75ZM15 20.3125C15 20.83 14.58 21.25 14.0625 21.25H4.6875C4.17 21.25 3.75 20.83 3.75 20.3125V19.6875C3.75 17.7913 5.29125 16.25 7.1875 16.25H11.5625C13.4587 16.25 15 17.7913 15 19.6875V20.3125ZM25.3125 21.25H18.4375C17.92 21.25 17.5 20.83 17.5 20.3125C17.5 19.795 17.92 19.375 18.4375 19.375H25.3125C25.83 19.375 26.25 19.795 26.25 20.3125C26.25 20.83 25.83 21.25 25.3125 21.25ZM25.3125 16.25H18.4375C17.92 16.25 17.5 15.83 17.5 15.3125C17.5 14.795 17.92 14.375 18.4375 14.375H25.3125C25.83 14.375 26.25 14.795 26.25 15.3125C26.25 15.83 25.83 16.25 25.3125 16.25ZM25.3125 11.25H18.4375C17.92 11.25 17.5 10.83 17.5 10.3125C17.5 9.795 17.92 9.375 18.4375 9.375H25.3125C25.83 9.375 26.25 9.795 26.25 10.3125C26.25 10.83 25.83 11.25 25.3125 11.25Z" fill="var(--accent)"/>
                    </svg>
                  </button>
                </div>
                <div className="relative">
                  <button
                    className={`px-2 py-0.5 rounded-md bg-[var(--secondary)] hover:bg-[color-mix(in_srgb,var(--primary)_14%,var(--secondary))] h-7.5 transition-all duration-200 ease-in-out cursor-pointer hover:scale-105 active:scale-95 ${
                      pinnedLeadId === record.id ? 'bg-[color-mix(in_srgb,var(--primary)_35%,var(--secondary))]' : ''
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePinLead(record.id);
                    }}
                    onMouseEnter={(e) => showTooltip(e, pinnedLeadId === record.id ? (record.type === 'Net' ? [t('leadsBlock.unpinReferral')] : t('leadsBlock.unpinLead')) : (record.type === 'Net' ? [t('leadsBlock.pinReferral')] : t('leadsBlock.pinLead')), `${record.id}-pin`)}
                    onMouseLeave={hideTooltip}
                  >
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M5.15508 0.137253L0.136026 5.20158C-0.0453426 5.38439 -0.0453426 5.68125 0.136026 5.86407L0.157292 5.88552C0.464959 6.19606 0.874221 6.36716 1.30939 6.36716C1.58976 6.36716 1.85879 6.29529 2.09736 6.16176L6.60445 11.4607C6.24524 11.8663 6.04865 12.3839 6.04865 12.9322C6.04865 13.523 6.27663 14.0783 6.69063 14.496L6.72211 14.5277C6.90339 14.7107 7.1974 14.7107 7.37868 14.5277L10.3855 11.4938L13.3139 14.4487C13.3741 14.5078 14.8025 15.9064 15.9392 16.8259C17.0214 17.7016 17.2196 17.8748 17.2299 17.8838C17.4134 18.0463 17.6901 18.0373 17.8634 17.8633C17.9541 17.7722 18 17.6519 18 17.5313C18 17.4214 17.9619 17.3112 17.8851 17.2226C17.8784 17.2148 17.7101 17.0193 16.8368 15.9203C15.9255 14.7735 14.5392 13.3323 14.476 13.2668L11.5523 10.3167L14.3981 7.44522C14.4888 7.35377 14.5341 7.23383 14.5341 7.11398C14.5341 6.99413 14.4888 6.8741 14.3981 6.78274L14.3666 6.75097C13.9527 6.33324 13.4022 6.1032 12.8168 6.1032C12.2734 6.1032 11.7604 6.30166 11.3585 6.66401L6.10687 2.11628C6.23921 1.87555 6.31044 1.6041 6.31044 1.3212C6.31044 0.882011 6.14095 0.469152 5.8331 0.15871L5.81184 0.137253C5.63038 -0.0457518 5.33636 -0.0457518 5.15508 0.137253Z" fill={pinnedLeadId === record.id ? "var(--primary-foreground)" : "var(--accent)"}/>
                    </svg>
                  </button>
                </div>
                <div className="relative">
                  <button 
                    className="p-2 py-1 rounded-md bg-[var(--secondary)] h-7.5 flex items-center justify-center hover:bg-[color-mix(in_srgb,var(--primary)_14%,var(--secondary))] transition-all duration-200 ease-in-out cursor-pointer hover:scale-105 active:scale-95"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (backendLead && onOpenNewTaskModal) {
                        onOpenNewTaskModal(backendLead._id);
                      }
                    }}
                    onMouseEnter={(e) => showTooltip(e, t('leadsBlock.addTask'), `${record.id}-task`)}
                    onMouseLeave={hideTooltip}
                  >
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M10 2.23438C10.2362 2.23438 10.4629 2.32809 10.6299 2.49512C10.7969 2.66214 10.8906 2.88879 10.8906 3.125V9.10938H16.875C17.1112 9.10938 17.3379 9.20309 17.5049 9.37012C17.6719 9.53714 17.7656 9.76379 17.7656 10C17.7656 10.2362 17.6719 10.4629 17.5049 10.6299C17.3379 10.7969 17.1112 10.8906 16.875 10.8906H10.8906V16.875C10.8906 17.1112 10.7969 17.3379 10.6299 17.5049C10.4629 17.6719 10.2362 17.7656 10 17.7656C9.76379 17.7656 9.53714 17.6719 9.37012 17.5049C9.20309 17.3379 9.10938 17.1112 9.10938 16.875V10.8906H3.125C2.88879 10.8906 2.66214 10.7969 2.49512 10.6299C2.32809 10.4629 2.23438 10.2362 2.23438 10C2.23438 9.76379 2.32809 9.53714 2.49512 9.37012C2.66214 9.20309 2.88879 9.10938 3.125 9.10938H9.10938V3.125C9.10938 2.88879 9.20309 2.66214 9.37012 2.49512C9.53714 2.32809 9.76379 2.23438 10 2.23438Z" fill="var(--accent)" stroke="var(--accent)" strokeWidth="0.09375"/>
                    </svg>
                  </button>
                </div>
              </div>
              <div className="text-base font-normal text-center w-full text-[var(--foreground)]">
                {record.name}
              </div>
              {record.type === 'Agent' && record.city && (
                <div className="text-base text-center w-full text-[var(--accent)] truncate" title={record.city}>
                  {t('leadsBlock.межрег')} · {record.city}
                </div>
              )}
              {/* Плашки тегов: сначала один слот, второй появляется после первого тега */}
              <div className="flex gap-1.5 justify-center w-full mt-1.5 flex-wrap">
                {((record.tags?.[0] != null ? [0, 1] : [0]) as number[]).map((slotIndex) => {
                  const tagValue = record.tags?.[slotIndex];
                  const isFilled = !!tagValue;
                  const tooltipLabel = isFilled ? `#${tagLabel(tagValue)}` : slotIndex === 0 ? [t('leadsBlock.addTag')] : t('leadsBlock.tag2');
                  return (
                    <div key={slotIndex} className="relative">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          setOpenTagEditor({ leadId: record.id, slotIndex });
                          setTagEditorAnchor({ top: rect.bottom + 4, left: rect.left });
                          setTimeout(() => tagEditorInputRef.current?.focus(), 50);
                        }}
                        onMouseEnter={(e) => showTooltip(e, tooltipLabel, `tag-${record.id}-${slotIndex}`)}
                        onMouseLeave={hideTooltip}
                        className={`inline-flex items-center justify-center gap-0.5 min-w-[2.5rem] max-w-[6rem] px-2 py-1 rounded-sm text-base font-medium truncate border transition-all duration-200 ${
                          isFilled
                            ? 'border-[color-mix(in_srgb,var(--accent)_38%,transparent)] bg-[color-mix(in_srgb,var(--primary)_16%,var(--card))] text-[var(--accent)] shadow-[inset_0_0_0_1px_rgba(201,168,76,0.12)] hover:bg-[color-mix(in_srgb,var(--primary)_22%,var(--card))]'
                            : 'border-[color-mix(in_srgb,var(--foreground)_28%,transparent)] bg-[var(--secondary)] text-[var(--muted-foreground)] hover:bg-[color-mix(in_srgb,var(--primary)_10%,var(--secondary))] hover:border-[color-mix(in_srgb,var(--accent)_25%,transparent)]'
                      }`}
                      title={tooltipLabel}
                    >
                      {isFilled ? (
                        <span className="truncate">#{tagLabel(tagValue)}</span>
                      ) : (
                        <span className="text-[var(--muted-foreground)] leading-none flex items-center justify-center">+</span>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col items-center justify-center gap-2 flex-1 md:max-w-35">
              <div className="size-14 rounded-full overflow-hidden hidden">
                <img
                  src={record.imageUrl}
                  alt={record.name}
                  className="w-full h-full object-cover"
                />
              </div>
              <span className="text-base font-normal text-center text-[var(--foreground)]">{record.name}</span>
              {record.type === 'Agent' && record.city && (
                <span className="text-base text-center w-full text-[var(--accent)] truncate" title={record.city}>
                  {t('leadsBlock.межрег')} · {record.city}
                </span>
              )}
              {/* Плашки тегов в строчном режиме: второй слот только при наличии первого */}
              <div className="flex gap-1.5 justify-center w-full flex-wrap">
                {((record.tags?.[0] != null ? [0, 1] : [0]) as number[]).map((slotIndex) => {
                  const tagValue = record.tags?.[slotIndex];
                  const isFilled = !!tagValue;
                  const tooltipLabel = isFilled ? `#${tagLabel(tagValue)}` : slotIndex === 0 ? [t('leadsBlock.addTag')] : t('leadsBlock.tag2');
                  return (
                    <button
                      key={slotIndex}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setOpenTagEditor({ leadId: record.id, slotIndex });
                        setTagEditorAnchor({ top: rect.bottom + 4, left: rect.left });
                        setTimeout(() => tagEditorInputRef.current?.focus(), 50);
                      }}
                      onMouseEnter={(e) => showTooltip(e, tooltipLabel, `tag-list-${record.id}-${slotIndex}`)}
                      onMouseLeave={hideTooltip}
                      className={`inline-flex items-center justify-center gap-0.5 min-w-[2.5rem] max-w-[5.5rem] px-2 py-1 rounded-sm text-base font-medium truncate border transition-all duration-200 ${
                        isFilled
                          ? 'border-[color-mix(in_srgb,var(--accent)_38%,transparent)] bg-[color-mix(in_srgb,var(--primary)_16%,var(--card))] text-[var(--accent)] shadow-[inset_0_0_0_1px_rgba(201,168,76,0.12)] hover:bg-[color-mix(in_srgb,var(--primary)_22%,var(--card))]'
                          : 'border-[color-mix(in_srgb,var(--foreground)_28%,transparent)] bg-[var(--secondary)] text-[var(--muted-foreground)] hover:bg-[color-mix(in_srgb,var(--primary)_10%,var(--secondary))] hover:border-[color-mix(in_srgb,var(--accent)_25%,transparent)]'
                      }`}
                      title={tooltipLabel}
                    >
                      {isFilled ? (
                        <span className="truncate">#{tagLabel(tagValue)}</span>
                      ) : (
                        <span className="text-[var(--muted-foreground)] leading-none flex items-center justify-center">+</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

          </>
        )}
        {!isGridMode && (
          <div className={`flex flex-col justify-center flex-1 md:min-w-[300px] md:min-w-3/4 ${selectedTab !== 'all' && viewMode !== 'list' ? 'opacity-50' : ''}`}>
            <div className='flex items-center justify-between flex-wrap md:gap-x-2 gap-y-3 md:gap-y-0 md:ml-10'>
            <span className="md:h-10 md:hidden text-base text-[var(--muted-foreground)]">{statusLabels[currentPosition - 1]}</span>
            <span className="h-10 hidden md:inline-block" style={{ fontSize: `${calculatedFontSize}rem` }}>{statusLabels[currentPosition - 1]}</span>
            {!isGridMode && (
          <div className="flex gap-2 flex-wrap" style={{ marginTop: '3px' }}>
            <div className='flex items-center gap-2'>
              <div className="relative">
                <button 
                  className="size-9 rounded-md bg-[var(--secondary)] flex items-center justify-center hover:bg-[color-mix(in_srgb,var(--primary)_14%,var(--secondary))] transition-all duration-200 ease-in-out cursor-pointer hover:scale-110 active:scale-95"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (backendLead) {
                      setInitialTab('info');
                      // Обновляем URL параметры - модалка откроется через useEffect
                      const newParams = new URLSearchParams(searchParams);
                      newParams.set('modal', 'lead');
                      newParams.set('leadId', backendLead._id);
                      newParams.set('tab', 'info');
                      setSearchParams(newParams, { replace: true });
                      if (onCloseChecklist) {
                        onCloseChecklist();
                      }
                    }
                  }}
                  onMouseEnter={(e) => showTooltip(e, record.type === 'Net' ? [t('leadsBlock.referralInfo')] : t('leadsBlock.clientInfo'), `${record.id}-info-list`)}
                  onMouseLeave={hideTooltip}
                >
                  <svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M26.5625 3.75H3.4375C1.54125 3.75 0 5.29125 0 7.1875V22.8125C0 24.7087 1.54125 26.25 3.4375 26.25H26.5625C28.4587 26.25 30 24.7087 30 22.8125V7.1875C30 5.29125 28.4587 3.75 26.5625 3.75ZM9.375 8.75C11.0975 8.75 12.5 10.1525 12.5 11.875C12.5 13.5975 11.0975 15 9.375 15C7.6525 15 6.25 13.5975 6.25 11.875C6.25 10.1525 7.6525 8.75 9.375 8.75ZM15 20.3125C15 20.83 14.58 21.25 14.0625 21.25H4.6875C4.17 21.25 3.75 20.83 3.75 20.3125V19.6875C3.75 17.7913 5.29125 16.25 7.1875 16.25H11.5625C13.4587 16.25 15 17.7913 15 19.6875V20.3125ZM25.3125 21.25H18.4375C17.92 21.25 17.5 20.83 17.5 20.3125C17.5 19.795 17.92 19.375 18.4375 19.375H25.3125C25.83 19.375 26.25 19.795 26.25 20.3125C26.25 20.83 25.83 21.25 25.3125 21.25ZM25.3125 16.25H18.4375C17.92 16.25 17.5 15.83 17.5 15.3125C17.5 14.795 17.92 14.375 18.4375 14.375H25.3125C25.83 14.375 26.25 14.795 26.25 15.3125C26.25 15.83 25.83 16.25 25.3125 16.25ZM25.3125 11.25H18.4375C17.92 11.25 17.5 10.83 17.5 10.3125C17.5 9.795 17.92 9.375 18.4375 9.375H25.3125C25.83 9.375 26.25 9.795 26.25 10.3125C26.25 10.83 25.83 11.25 25.3125 11.25Z" fill="var(--accent)"/>
                  </svg>
                </button>
              </div>
              <div className="relative">
                <button 
                  className="size-9 rounded-md bg-[var(--secondary)] flex items-center justify-center hover:bg-[color-mix(in_srgb,var(--primary)_14%,var(--secondary))] transition-all duration-200 ease-in-out cursor-pointer hover:scale-110 active:scale-95"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (backendLead && onOpenNewTaskModal) {
                      onOpenNewTaskModal(backendLead._id);
                    }
                  }}
                  onMouseEnter={(e) => showTooltip(e, t('leadsBlock.addTask'), `${record.id}-task-list`)}
                  onMouseLeave={hideTooltip}
                >
                  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M5.81961 15V9.18H-0.000390455V5.79H5.81961V0H9.20961V5.79H14.9996V9.18H9.20961V15H5.81961Z" fill="var(--accent)"/>
                  </svg>
                </button>
              </div>
              <div className="relative">
                <button
                  className={`size-9 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
                    pinnedLeadId === record.id
                      ? 'bg-[color-mix(in_srgb,var(--primary)_35%,var(--secondary))]'
                      : 'bg-[var(--secondary)] hover:bg-[color-mix(in_srgb,var(--primary)_14%,var(--secondary))]'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    togglePinLead(record.id);
                  }}
                  onMouseEnter={(e) => showTooltip(e, pinnedLeadId === record.id ? (record.type === 'Net' ? [t('leadsBlock.unpinReferral')] : t('leadsBlock.unpinLead')) : (record.type === 'Net' ? [t('leadsBlock.pinReferral')] : t('leadsBlock.pinLead')), `${record.id}-pin-list`)}
                  onMouseLeave={hideTooltip}
                >
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M5.15508 0.137253L0.136026 5.20158C-0.0453426 5.38439 -0.0453426 5.68125 0.136026 5.86407L0.157292 5.88552C0.464959 6.19606 0.874221 6.36716 1.30939 6.36716C1.58976 6.36716 1.85879 6.29529 2.09736 6.16176L6.60445 11.4607C6.24524 11.8663 6.04865 12.3839 6.04865 12.9322C6.04865 13.523 6.27663 14.0783 6.69063 14.496L6.72211 14.5277C6.90339 14.7107 7.1974 14.7107 7.37868 14.5277L10.3855 11.4938L13.3139 14.4487C13.3741 14.5078 14.8025 15.9064 15.9392 16.8259C17.0214 17.7016 17.2196 17.8748 17.2299 17.8838C17.4134 18.0463 17.6901 18.0373 17.8634 17.8633C17.9541 17.7722 18 17.6519 18 17.5313C18 17.4214 17.9619 17.3112 17.8851 17.2226C17.8784 17.2148 17.7101 17.0193 16.8368 15.9203C15.9255 14.7735 14.5392 13.3323 14.476 13.2668L11.5523 10.3167L14.3981 7.44522C14.4888 7.35377 14.5341 7.23383 14.5341 7.11398C14.5341 6.99413 14.4888 6.8741 14.3981 6.78274L14.3666 6.75097C13.9527 6.33324 13.4022 6.1032 12.8168 6.1032C12.2734 6.1032 11.7604 6.30166 11.3585 6.66401L6.10687 2.11628C6.23921 1.87555 6.31044 1.6041 6.31044 1.3212C6.31044 0.882011 6.14095 0.469152 5.8331 0.15871L5.81184 0.137253C5.63038 -0.0457518 5.33636 -0.0457518 5.15508 0.137253Z" fill={pinnedLeadId === record.id ? "var(--primary-foreground)" : "var(--accent)"}/>
                  </svg>
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2 md:min-w-25">
              {/* Кнопка t('leadsBlock.contact') — звонок и сообщение в одном меню */}
              <div className="relative">
                <button
                  className="flex items-center justify-center gap-2 h-9 px-4 rounded-md bg-[var(--accent)] transition-all duration-200 ease-in-out cursor-pointer hover:scale-105 active:scale-95"
                  onClick={(e) => {
                    e.stopPropagation();
                    const button = e.currentTarget;
                    const rect = button.getBoundingClientRect();
                    if (openContactMenu === record.id) {
                      setOpenContactMenu(null);
                      setContactMenuPosition(null);
                    } else {
                      setOpenContactMenu(record.id);
                      setContactMenuPosition({
                        top: rect.bottom + 8,
                        right: window.innerWidth - rect.right,
                      });
                    }
                  }}
                  onMouseEnter={(e) => showTooltip(e, record.type === 'Net' ? [t('leadsBlock.contactReferral')] : t('leadsBlock.contactClient'), `${record.id}-contact`)}
                  onMouseLeave={hideTooltip}
                >
                  <svg width="20" height="20" viewBox="25.25 8 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M42.4818 21.9201C41.2736 20.8867 40.0474 20.2608 38.8541 21.2926L38.1415 21.9162C37.6201 22.3689 36.6508 24.484 32.9029 20.1726C29.1557 15.8666 31.3856 15.1962 31.9077 14.7474L32.6242 14.123C33.8113 13.0889 33.3633 11.787 32.5071 10.4469L31.9905 9.63524C31.1304 8.29826 30.1938 7.42021 29.0035 8.4528L28.3604 9.01475C27.8344 9.39797 26.3639 10.6436 26.0072 13.0101C25.578 15.8495 26.9321 19.101 30.0346 22.6686C33.1331 26.2378 36.1669 28.0306 39.0406 27.9993C41.4289 27.9736 42.8712 26.692 43.3224 26.2261L43.9678 25.6633C45.1549 24.6315 44.4174 23.581 43.2084 22.5453L42.4818 21.9201Z" fill="white"/>
                  </svg>
                  <span className="text-base font-normal text-white">{t('leadsBlock.contact')}</span>
                </button>
                {/* Меню звонка и сообщения — рендерится через Portal */}
              </div>
            </div>
          </div>
        )}
            </div>
            {/* Горизонтальный слайдер - на мобильных открывает модалку с вертикальным UI */}
            <div 
              className="relative cursor-pointer md:cursor-default" 
              style={{ paddingTop: '18.5px', paddingBottom: '18.5px' }}
              onClick={(e) => {
                // На мобильных открываем модалку при клике на слайдер
                if (window.innerWidth < 768) {
                  e.stopPropagation();
                  setSelectedLeadForStageModal(record);
                  setIsMobileStageModalOpen(true);
                }
              }}
            >
              <div className="relative h-[8.5px] rounded-full overflow-hidden">
                {statusLabels.length > 0 && statusLabels.map((_: string, index: number) => {
                  // Создаем сегменты между позициями
                  // Для N статусов создаем N-1 сегментов (от позиции 1 до 2, от 2 до 3, ..., от N-1 до N)
                  if (index >= statusLabels.length - 1) return null;
                  
                  const nextPosition = index + 2;
                  
                  // Позиция сегмента: от позиции index+1 до позиции index+2
                  const leftPercent = (index / (statusLabels.length - 1)) * 100;
                  const widthPercent = 100 / (statusLabels.length - 1);
                  
                  // Определяем, к какой группе относится этот сегмент
                  // Сегмент между позициями index+1 и index+2 относится к группе целевой позиции (index+2)
                  // Целевая позиция index+2 соответствует индексу index+1 в массиве statusLabels
                  const targetIndex = index + 1;
                  const group = statusGroups.find(g => targetIndex >= g.startIndex && targetIndex <= g.endIndex);
                  if (!group) return null;
                  
                  // Сегмент окрашивается в зависимости от того, прошёл ли ползунок этот сегмент
                  // Если currentPosition >= nextPosition, то ползунок прошёл этот сегмент (leftColor)
                  // Если currentPosition < nextPosition, то ползунок ещё не прошёл этот сегмент (rightColor)
                  const isPartBeforeSlider = currentPosition >= nextPosition;
                  
                  // Проверяем, является ли этап на позиции nextPosition (index+2) этапом t('leadsBlock.startWork')
                  // Сегмент между позициями index+1 и index+2 соответствует этапу на позиции index+2 (nextPosition)
                  // Позиция index+2 в слайдере соответствует индексу index+1 в массиве statusList
                  const statusList = viewMode === 'list' ? allStatusLabels : statusLabels;
                  const nextStageLabel = statusList[index + 1];
                  const isWorkStartedStage = nextStageLabel === t('leadsBlock.workStarted');
                  
                  // Если это сегмент этапа t('leadsBlock.startWork'), используем желтый цвет
                  const segmentColor = isWorkStartedStage
                    ? (isPartBeforeSlider ? 'rgb(255, 204, 0)' : 'rgb(255, 240, 179)')
                    : (isPartBeforeSlider ? group.leftColor : group.rightColor);
                  
                  return (
                    <div
                      key={index}
                      className="absolute top-0 h-full border-r-3 border-white last:border-r-0"
                      style={{
                        left: `${leftPercent}%`,
                        width: `${widthPercent}%`,
                        backgroundColor: segmentColor,
                        transition: 'background-color 0.1s ease-out'
                      }}
                    />
                  );
                })}
                
                {/* Input слайдер скрыт на мобильных, работает только на десктопе */}
                <input
                  type="range"
                  min="1"
                  max={statusLabels.length}
                  step="1"
                  value={currentPosition}
                  onMouseDown={() => showChecklistOverlay(record.id)}
                  onTouchStart={() => showChecklistOverlay(record.id)}
                  onChange={(e) => updateSliderPosition(record.id, Number(e.target.value))}
                  disabled={selectedTab !== 'all' && viewMode !== 'list'}
                  className={`hidden md:block absolute top-0 left-0 w-full h-full opacity-0 z-30 ${
                    (selectedTab === 'all' || viewMode === 'list') ? 'cursor-pointer' : 'cursor-not-allowed'
                  }`}
                  style={{
                    WebkitAppearance: 'none',
                    appearance: 'none',
                    background: 'transparent'
                  }}
                />
              </div>
              
              {(() => {
                const currentIndex = currentPosition - 1;
                const currentGroup = statusGroups.find(g => currentIndex >= g.startIndex && currentIndex <= g.endIndex);
                
                // Проверяем, является ли текущий этап t('leadsBlock.startWork')
                const statusList = viewMode === 'list' ? allStatusLabels : statusLabels;
                const currentStatusLabel = statusList[currentIndex];
                const isWorkStarted = backendLead?.stage === LeadStage.NETWORK_WORK_STARTED || currentStatusLabel === t('leadsBlock.workStarted');
                
                const sliderColor = isWorkStarted
                  ? 'rgb(255, 204, 0)'
                  : currentGroup 
                    ? (currentGroup.startIndex === 0 ? currentGroup.rightColor : currentGroup.leftColor)
                    : '#c9a84c';
                
                const rgbMatch = sliderColor.match(/\d+/g);
                const strokeColor = rgbMatch 
                  ? `rgba(${rgbMatch[0]}, ${rgbMatch[1]}, ${rgbMatch[2]}, 0.6)`
                  : isWorkStarted
                    ? 'rgba(255, 240, 179, 0.6)'
                    : 'rgba(201, 168, 76, 0.55)';
                
                return (
                  <svg
                    width="17"
                    height="39"
                    viewBox="0 0 17 39"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    className="absolute pointer-events-none z-20"
                    style={{
                      left: `calc(${((currentPosition - 1) / (statusLabels.length - 1)) * 100}% - 8.5px)`,
                      top: '50%',
                      transform: 'translateY(-50%) translateZ(0)',
                      transition: 'left 0.1s ease-out',
                      willChange: 'left'
                    }}
                  >
                    <path 
                      d="M8.5 0.5C9.50751 0.5 10.5068 0.966717 11.46 1.8916C12.4155 2.81878 13.2991 4.1844 14.0518 5.91113C15.5565 9.36323 16.5 14.1673 16.5 19.5C16.5 24.8327 15.5565 29.6368 14.0518 33.0889C13.2991 34.8156 12.4155 36.1812 11.46 37.1084C10.5068 38.0333 9.50751 38.5 8.5 38.5C7.49249 38.5 6.49322 38.0333 5.54004 37.1084C4.58451 36.1812 3.70094 34.8156 2.94824 33.0889C1.44348 29.6368 0.5 24.8327 0.5 19.5C0.5 14.1673 1.44348 9.36323 2.94824 5.91113C3.70094 4.1844 4.58451 2.81878 5.54004 1.8916C6.49322 0.966717 7.49249 0.5 8.5 0.5Z" 
                      fill={sliderColor} 
                      stroke={strokeColor}
                      style={{
                        transition: 'fill 0.2s ease-out, stroke 0.2s ease-out'
                      }}
                    />
                  </svg>
                );
              })()}
            </div>
            
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`flex flex-col w-full py-5 md:mt-6 rounded-lg bg-[var(--card)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_12%,transparent)] gap-8 min-w-0 max-w-full ${isLeadsBlockCollapsed ? 'md:h-301' : 'h-auto'}`}>
      
      <button
        type="button"
        onClick={() => setIsLeadsBlockCollapsed(!isLeadsBlockCollapsed)}
        className="w-full md:hidden flex items-center justify-between px-5 cursor-pointer"

      >
        <div className="flex items-center gap-2">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M9.9995 12.9111C10.8988 12.9111 11.6279 12.182 11.6279 11.2827C11.6279 10.3834 10.8988 9.6543 9.9995 9.6543C9.10015 9.6543 8.37109 10.3834 8.37109 11.2827C8.37109 12.182 9.10015 12.9111 9.9995 12.9111Z" fill="var(--accent)"/>
            <path d="M4.80498 14.0006C5.50952 14.0006 6.08067 13.4294 6.08067 12.7249C6.08067 12.0204 5.50952 11.4492 4.80498 11.4492C4.10044 11.4492 3.5293 12.0204 3.5293 12.7249C3.5293 13.4294 4.10044 14.0006 4.80498 14.0006Z" fill="var(--accent)"/>
            <path d="M15.1956 14.0006C15.9001 14.0006 16.4713 13.4294 16.4713 12.7249C16.4713 12.0204 15.9001 11.4492 15.1956 11.4492C14.4911 11.4492 13.9199 12.0204 13.9199 12.7249C13.9199 13.4294 14.4911 14.0006 15.1956 14.0006Z" fill="var(--accent)"/>
            <path fillRule="evenodd" clipRule="evenodd" d="M5.75596 14.8867H4.11767C3.31752 14.8867 2.66211 15.5421 2.66211 16.3423V17.7978H6.65229V15.8858C6.65229 15.675 6.68124 15.4677 6.73687 15.2689C6.468 15.0227 6.1216 14.8867 5.75596 14.8867Z" fill="var(--accent)"/>
            <path fillRule="evenodd" clipRule="evenodd" d="M11.0463 13.9727H8.95496C7.90377 13.9727 7.04297 14.8335 7.04297 15.8846V17.7967H12.9582V15.8846C12.9582 14.8335 12.0975 13.9727 11.0463 13.9727Z" fill="var(--accent)"/>
            <path fillRule="evenodd" clipRule="evenodd" d="M15.8829 14.8867H14.2446C13.8789 14.8867 13.5326 15.0227 13.2637 15.2689C13.3193 15.4677 13.3482 15.675 13.3482 15.8858V17.7978H17.3384V16.3423C17.3384 15.5421 16.683 14.8867 15.8829 14.8867Z" fill="var(--accent)"/>
            <path fillRule="evenodd" clipRule="evenodd" d="M11.4085 4.43642V3.0764C11.4085 2.5961 11.0156 2.20312 10.5353 2.20312H9.46478C8.98448 2.20312 8.5915 2.5961 8.5915 3.0764V4.43642C7.78452 4.60898 7.03143 4.92681 6.3608 5.36107L5.39865 4.39893C5.05902 4.0593 4.50329 4.0593 4.16366 4.39893L3.40674 5.15586C3.06711 5.49549 3.06711 6.05121 3.40674 6.39084L4.36886 7.35297C3.93455 8.02358 3.6167 8.77672 3.44413 9.5837H2.08421C1.6039 9.5837 1.21094 9.97667 1.21094 10.457V11.5274C1.21094 12.0077 1.60392 12.4007 2.08421 12.4007H3.16938C3.32006 11.6354 3.99487 11.058 4.80426 11.058C5.05171 11.058 5.28658 11.112 5.49774 11.2088C5.49433 11.137 5.4926 11.0648 5.4926 10.9922C5.4926 8.50285 7.51067 6.4848 10 6.4848C12.4894 6.4848 14.5074 8.50285 14.5074 10.9922C14.5074 11.0648 14.5057 11.137 14.5023 11.2088C14.7135 11.112 14.9483 11.058 15.1958 11.058C16.0052 11.058 16.68 11.6354 16.8306 12.4007H17.9158C18.3961 12.4007 18.7891 12.0077 18.7891 11.5274V10.457C18.7891 9.97667 18.3961 9.5837 17.9158 9.5837H16.5562C16.3835 8.77672 16.0656 8.02361 15.6312 7.35294L16.5933 6.39084C16.9329 6.05121 16.9329 5.49549 16.5933 5.15586L15.8364 4.39893C15.4967 4.0593 14.941 4.0593 14.6014 4.39893L13.6393 5.36103C12.9687 4.92675 12.2155 4.60898 11.4085 4.43642Z" fill="var(--accent)"/>
          </svg>
          <span className="hidden md:block">{t('leadsBlock.manageClients')}</span>
          <span className="md:hidden">{t('leadsBlock.clients')}</span>
        </div>
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`transition-transform duration-300 ease-in-out ${isLeadsBlockCollapsed ? 'rotate-180' : ''}`}
        >
          <path d="M12.0007 10.8273L7.05072 15.7773L5.63672 14.3633L12.0007 7.99935L18.3647 14.3633L16.9507 15.7773L12.0007 10.8273Z" fill="var(--accent)"/>
        </svg>
      </button>
      <div className={`${isLeadsBlockCollapsed ? 'hidden md:flex' : 'flex flex-col gap-4'}`}>
        <div className="flex min-w-0 items-center justify-between gap-3 px-5">
          <div className="flex min-h-0 min-w-0 flex-1 flex-wrap items-center gap-5 md:flex-wrap">
          <span className="hidden md:block font-normal text-base">{t('leadsBlock.selectProduct')}</span>
          <span className="block md:hidden font-normal text-base">{t('leadsBlock.product')}</span>
          <div className='flex items-center gap-1 md:gap-4 md:flex-wrap'>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="product"
                value="RP"
                checked={selectedProduct === 'RP'}
                onChange={(e) => setSelectedProduct(e.target.value as 'RP' | 'Net')}
                className="sr-only"
              />
              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all duration-200 ${
                selectedProduct === 'RP'
                  ? 'border-[var(--primary)] bg-[var(--card)]'
                  : 'border-[color-mix(in_srgb,var(--foreground)_42%,transparent)]'
              }`}>
                {selectedProduct === 'RP' && (
                  <div className="w-2 h-2 rounded-full bg-dream-primary" />
                )}
              </div>
              <span className={"hidden md:block " + (selectedProduct === 'RP' ? 'text-dream-primary' : '')}>
                {t('leadsBlock.productTabSales')}
              </span>
              <span className={"block md:hidden " + (selectedProduct === 'RP' ? 'text-dream-primary' : '')}>
                {t('leadsBlock.productTabSalesShort')}
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="product"
                value="Net"
                checked={selectedProduct === 'Net'}
                onChange={(e) => setSelectedProduct(e.target.value as 'RP' | 'Net')}
                className="sr-only"
              />
              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all duration-200 ${
                selectedProduct === 'Net'
                  ? 'border-[var(--primary)] bg-[var(--card)]'
                  : 'border-[color-mix(in_srgb,var(--foreground)_42%,transparent)]'
              }`}>
                {selectedProduct === 'Net' && (
                  <div className="w-2 h-2 rounded-full bg-dream-primary" />
                )}
              </div>
              <span className={"hidden md:block " + (selectedProduct === 'Net' ? 'text-dream-primary' : '')}>
                {t('leadsBlock.productTabNetwork')}
              </span>
              <span className={"block md:hidden " + (selectedProduct === 'Net' ? 'text-dream-primary' : '')}>
                {t('leadsBlock.productTabNetworkShort')}
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="product"
                value="Owner"
                checked={selectedProduct === 'Owner'}
                onChange={(e) => setSelectedProduct(e.target.value as ProductTab)}
                className="sr-only"
              />
              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all duration-200 ${
                selectedProduct === 'Owner'
                  ? 'border-[var(--primary)] bg-[var(--card)]'
                  : 'border-[color-mix(in_srgb,var(--foreground)_42%,transparent)]'
              }`}>
                {selectedProduct === 'Owner' && (
                  <div className="w-2 h-2 rounded-full bg-dream-primary" />
                )}
              </div>
              <span className={"hidden md:block " + (selectedProduct === 'Owner' ? 'text-dream-primary' : '')}>
                {t('leadsBlock.productTabOwner')}
              </span>
              <span className={"block md:hidden " + (selectedProduct === 'Owner' ? 'text-dream-primary' : '')}>
                {t('leadsBlock.productTabOwnerShort')}
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="product"
                value="Agent"
                checked={selectedProduct === 'Agent'}
                onChange={(e) => setSelectedProduct(e.target.value as ProductTab)}
                className="sr-only"
              />
              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all duration-200 ${
                selectedProduct === 'Agent'
                  ? 'border-[var(--primary)] bg-[var(--card)]'
                  : 'border-[color-mix(in_srgb,var(--foreground)_42%,transparent)]'
              }`}>
                {selectedProduct === 'Agent' && (
                  <div className="w-2 h-2 rounded-full bg-dream-primary" />
                )}
              </div>
              <span className={"hidden md:block " + (selectedProduct === 'Agent' ? 'text-dream-primary' : '')}>
                {t('leadsBlock.productTabAgent')}
              </span>
              <span className={"block md:hidden " + (selectedProduct === 'Agent' ? 'text-dream-primary' : '')}>
                {t('leadsBlock.productTabAgentShort')}
              </span>
            </label>
          </div>
        </div>
        
        <div className="hidden shrink-0 md:flex md:flex-shrink-0 items-center gap-2 flex-wrap">
          <Tooltip text={t('leadsBlock.listView')} position="bottom">
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className="cursor-pointer relative group"
              aria-label={t('leadsBlock.list')}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ opacity: viewMode === 'list' ? 1 : 0.5 }}>
                <path d="M2 7H22C22.2652 7 22.5196 6.89464 22.7071 6.70711C22.8946 6.51957 23 6.26522 23 6C23 5.73478 22.8946 5.48043 22.7071 5.29289C22.5196 5.10536 22.2652 5 22 5H2C1.73478 5 1.48043 5.10536 1.29289 5.29289C1.10536 5.48043 1 5.73478 1 6C1 6.26522 1.10536 6.51957 1.29289 6.70711C1.48043 6.89464 1.73478 7 2 7Z" fill="var(--accent)"/>
                <path d="M22 11H2C1.73478 11 1.48043 11.1054 1.29289 11.2929C1.10536 11.4804 1 11.7348 1 12C1 12.2652 1.10536 12.5196 1.29289 12.7071C1.48043 12.8946 1.73478 13 2 13H22C22.2652 13 22.5196 12.8946 22.7071 12.7071C22.8946 12.5196 23 12.2652 23 12C23 11.7348 22.8946 11.4804 22.7071 11.2929C22.5196 11.1054 22.2652 11 22 11Z" fill="var(--accent)"/>
                <path d="M22 17H2C1.73478 17 1.48043 17.1054 1.29289 17.2929C1.10536 17.4804 1 17.7348 1 18C1 18.2652 1.10536 18.5196 1.29289 18.7071C1.48043 18.8946 1.73478 19 2 19H22C22.2652 19 22.5196 18.8946 22.7071 18.7071C22.8946 18.5196 23 18.2652 23 18C23 17.7348 22.8946 17.4804 22.7071 17.2929C22.5196 17.1054 22.2652 17 22 17Z" fill="var(--accent)"/>
              </svg>
            </button>
          </Tooltip>
          <Tooltip text={t('leadsBlock.columnsView')} position="bottom">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className="cursor-pointer relative group"
              aria-label={t('leadsBlock.columns')}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <g opacity={viewMode === 'grid' ? 1 : 0.5}>
                  <path d="M10.5 4.1V19.9C10.5 21.4 9.86249 22 8.26874 22H4.23126C2.63751 22 2 21.4 2 19.9V4.1C2 2.6 2.63751 2 4.23126 2H8.26874C9.86249 2 10.5 2.6 10.5 4.1ZM19.7687 2H15.7313C14.1375 2 13.5 2.6 13.5 4.1V12.9C13.5 14.4 14.1375 15 15.7313 15H19.7687C21.3625 15 22 14.4 22 12.9V4.1C22 2.6 21.3625 2 19.7687 2Z" fill="var(--accent)"/>
                </g>
              </svg>
            </button>
          </Tooltip>
          <Tooltip
            text={showChecklist ? [t('leadsBlock.disableChecklist')] : t('leadsBlock.enableChecklist')}
            position="bottom"
          >
            <button
              type="button"
              onClick={() => {
                const newValue = !showChecklist;
                setShowChecklist(newValue);
                localStorage.setItem('leadsShowChecklist', newValue.toString());
              }}
              className="relative z-10 inline-flex min-h-10 min-w-10 cursor-pointer items-center justify-center rounded-[4px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--accent)]"
              aria-label={t('leadsBlock.stageChecklist')}
              aria-pressed={showChecklist}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ opacity: showChecklist ? 1 : 0.5 }}>
                <path d="M9 12L11 14L15 10M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              </svg>
            </button>
          </Tooltip>
          <div className="relative z-10 group">
            <button
              ref={sizeMenuButtonRef}
              type="button"
              onClick={() => {
                if (isSizeMenuOpen) {
                  setIsSizeMenuOpen(false);
                } else {
                  updateSizeMenuPosition();
                  setIsSizeMenuOpen(true);
                }
              }}
              className="relative z-10 flex cursor-pointer items-center"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <g clipPath="url(#clip0_4159_59956)">
                <path fillRule="evenodd" clipRule="evenodd" d="M20.1191 23.9859H13.7079C13.3001 23.9859 12.9627 23.6485 12.9627 23.2408C12.9627 22.833 13.3001 22.4956 13.7079 22.4956H20.1191C21.4267 22.4956 22.4952 21.4271 22.4952 20.1195V3.89455C22.4952 2.57294 21.4267 1.50439 20.1191 1.50439H3.89416C2.57255 1.50439 1.50401 2.57294 1.50401 3.89455V9.86995C1.50401 10.2777 1.16657 10.6151 0.758839 10.6151C0.351106 10.6151 0.0136719 10.2777 0.0136719 9.86995V3.89455C0.0136719 1.74341 1.75708 0 3.89416 0H20.1191C22.2562 0 23.9856 1.74341 23.9856 3.89455V20.1195C23.9856 22.2566 22.2562 23.9859 20.1191 23.9859Z" fill="var(--accent)"/>
                <path fillRule="evenodd" clipRule="evenodd" d="M9.89768 23.9859H2.23511C1.01191 23.9859 0.0136719 23.0017 0.0136719 21.7785V14.116C0.0136719 12.8928 1.01191 11.8945 2.23511 11.8945H9.89768C11.1209 11.8945 12.1191 12.8928 12.1191 14.116V21.7785C12.1191 23.0017 11.1209 23.9859 9.89768 23.9859Z" fill="var(--accent)"/>
                <path fillRule="evenodd" clipRule="evenodd" d="M18.3057 18.6993H14.4815C14.0738 18.6993 13.7363 18.3618 13.7363 17.94C13.7363 17.5323 14.0738 17.1949 14.4815 17.1949H18.3057L17.2794 16.1685C16.9982 15.8732 16.9982 15.3952 17.2794 15.114C17.5746 14.8188 18.0527 14.8188 18.3479 15.114L20.5975 17.3636C20.6115 17.3776 20.6256 17.3917 20.6537 17.4058C20.7521 17.5182 20.8224 17.6588 20.8506 17.7994C20.8787 17.94 20.8646 18.0947 20.8084 18.2353C20.7662 18.3478 20.6959 18.4462 20.5975 18.5165L18.3479 20.7801C18.1933 20.9207 18.0105 20.991 17.8137 20.991C17.6168 20.991 17.434 20.9207 17.2794 20.7801C16.9982 20.4848 16.9982 20.0068 17.2794 19.7116L18.3057 18.6993Z" fill="var(--accent)"/>
                <path fillRule="evenodd" clipRule="evenodd" d="M6.05917 10.2773C5.63738 10.2773 5.29994 9.93991 5.29994 9.51812V5.69387L4.28764 6.70617C4.00645 7.00143 3.52841 7.00143 3.23316 6.70617C2.93791 6.42498 2.93791 5.94694 3.23316 5.65169L5.4546 3.43025C5.46866 3.40213 5.49678 3.37401 5.5249 3.35995C5.8061 3.06469 6.28413 3.06469 6.57938 3.34589L8.88518 5.63763C9.18044 5.93288 9.18044 6.41092 8.88518 6.70617C8.74458 6.86083 8.54775 6.93113 8.36497 6.93113C8.16813 6.93113 7.9713 6.86083 7.8307 6.70617L6.80434 5.67981V9.53218C6.80434 9.93991 6.4669 10.2773 6.05917 10.2773Z" fill="var(--accent)"/>
                </g>
                <defs>
                <clipPath id="clip0_4159_59956">
                <rect width="24" height="24" fill="white"/>
                </clipPath>
                </defs>
              </svg>
            </button>
            <div 
                      className="tooltip absolute bottom-full left-1/2 mb-2 px-3 py-1.5 bg-gray-800 text-white text-base leading-snug rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-[99999] shadow-xl"
              style={{
                transform: 'translateX(-50%)',
                maxWidth: 'calc(100vw - 20px)'
              }}
            >
              {viewMode === 'list' ? [t('leadsBlock.adjustFontSize')] : t('leadsBlock.adjustCardSize')}
            </div>
            {isSizeMenuOpen &&
              sizeMenuPosition &&
              createPortal(
                <div
                  ref={sizeMenuRef}
                  className="fixed z-[70] box-border w-[min(370px,calc(100vw-24px))] max-h-[min(420px,calc(100dvh-24px))] overflow-y-auto overscroll-contain rounded-[6px] border border-[var(--border)] bg-[var(--card)] p-4 shadow-lg flex flex-col gap-7.5 items-center"
                  style={{ top: sizeMenuPosition.top, left: sizeMenuPosition.left }}
                >
                <div className='flex items-center gap-5'>
                  <div>
                    <svg width="46" height="46" viewBox="0 0 46 46" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <g clipPath="url(#clip0_4159_59991)">
                      <path fillRule="evenodd" clipRule="evenodd" d="M38.5628 45.9731H26.2746C25.4931 45.9731 24.8463 45.3263 24.8463 44.5448C24.8463 43.7633 25.4931 43.1166 26.2746 43.1166H38.5628C41.0689 43.1166 43.117 41.0685 43.117 38.5624V7.46456C43.117 4.93146 41.0689 2.88342 38.5628 2.88342H7.46495C4.93185 2.88342 2.88382 4.93146 2.88382 7.46456V18.9174C2.88382 19.6989 2.23707 20.3456 1.45558 20.3456C0.674092 20.3456 0.0273438 19.6989 0.0273438 18.9174V7.46456C0.0273438 3.34153 3.36888 0 7.46495 0H38.5628C42.6589 0 45.9734 3.34153 45.9734 7.46456V38.5624C45.9734 42.6585 42.6589 45.9731 38.5628 45.9731Z" fill="var(--accent)"/>
                      <path fillRule="evenodd" clipRule="evenodd" d="M18.9717 45.974H4.28511C1.94064 45.974 0.0273438 44.0876 0.0273438 41.7432V27.0566C0.0273438 24.7121 1.94064 22.7988 4.28511 22.7988H18.9717C21.3162 22.7988 23.2295 24.7121 23.2295 27.0566V41.7432C23.2295 44.0876 21.3162 45.974 18.9717 45.974Z" fill="var(--accent)"/>
                      <path fillRule="evenodd" clipRule="evenodd" d="M35.0862 35.8411H27.7564C26.9749 35.8411 26.3281 35.1943 26.3281 34.3859C26.3281 33.6044 26.9749 32.9576 27.7564 32.9576H35.0862L33.119 30.9904C32.58 30.4245 32.58 29.5083 33.119 28.9694C33.6849 28.4034 34.6011 28.4034 35.167 28.9694L39.4787 33.281C39.5056 33.308 39.5326 33.3349 39.5865 33.3619C39.7751 33.5774 39.9098 33.8469 39.9637 34.1164C40.0176 34.3859 39.9907 34.6823 39.8829 34.9518C39.8021 35.1674 39.6673 35.356 39.4787 35.4907L35.167 39.8293C34.8706 40.0988 34.5203 40.2336 34.143 40.2336C33.7657 40.2336 33.4154 40.0988 33.119 39.8293C32.58 39.2634 32.58 38.3472 33.119 37.7813L35.0862 35.8411Z" fill="var(--accent)"/>
                      <path fillRule="evenodd" clipRule="evenodd" d="M11.6144 19.6979C10.806 19.6979 10.1592 19.0512 10.1592 18.2427V10.9129L8.21896 12.8532C7.68 13.4191 6.76377 13.4191 6.19787 12.8532C5.63196 12.3142 5.63196 11.398 6.19787 10.8321L10.4556 6.57432C10.4826 6.52042 10.5365 6.46653 10.5904 6.43958C11.1293 5.87367 12.0456 5.87367 12.6115 6.41263L17.0309 10.8051C17.5968 11.371 17.5968 12.2873 17.0309 12.8532C16.7614 13.1496 16.3842 13.2843 16.0338 13.2843C15.6566 13.2843 15.2793 13.1496 15.0098 12.8532L13.0426 10.886V18.2697C13.0426 19.0512 12.3959 19.6979 11.6144 19.6979Z" fill="var(--accent)"/>
                      </g>
                      <defs>
                      <clipPath id="clip0_4159_59991">
                      <rect width="46" height="46" fill="white"/>
                      </clipPath>
                      </defs>
                    </svg>
                  </div>
                  <div className='flex flex-col'>
                    <span className='text-dream-primary text-base'>
                      {viewMode === 'list' ? [t('leadsBlock.adjustFontSize')] : t('leadsBlock.adjustCardSize')}
                    </span>
                    <span className='text-[var(--muted-foreground)] text-base leading-snug'>
                      {viewMode === 'list' 
                        ? [t('leadsBlock.fontSizeDesc')] 
                        : t('leadsBlock.cardSizeDesc')}
                    </span>
                  </div>
                </div>
                <div className='w-full mt-0 px-0.5 flex flex-col gap-3'>
                  <div className='flex items-center gap-2 justify-between'>
                    <button 
                      onClick={() => {
                        if (viewMode === 'list') {
                          setFontSize(prev => Math.max(0, prev - 5));
                        } else {
                          setColumnWidth(prev => Math.max(0, prev - 5));
                        }
                      }}
                      className='flex items-center gap-2.5 cursor-pointer hover:opacity-80 transition-all duration-200 ease-in-out hover:scale-105 active:scale-95'
                    >
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <g clipPath="url(#clip0_4159_60004)">
                        <path d="M10 20C4.48578 20 0 15.5142 0 10C0 4.48578 4.48578 0 10 0C15.5142 0 20 4.48578 20 10C20 15.5142 15.5142 20 10 20ZM10 1.25C5.17502 1.25 1.25 5.17502 1.25 10C1.25 14.825 5.17502 18.75 10 18.75C14.825 18.75 18.75 14.825 18.75 10C18.75 5.17502 14.825 1.25 10 1.25Z" fill="var(--accent)"/>
                        <path d="M14.375 10.625H5.625C5.28 10.625 5 10.345 5 10C5 9.655 5.28 9.375 5.625 9.375H14.375C14.72 9.375 15 9.655 15 10C15 10.345 14.72 10.625 14.375 10.625Z" fill="var(--accent)"/>
                        </g>
                        <defs>
                        <clipPath id="clip0_4159_60004">
                        <rect width="20" height="20" fill="white"/>
                        </clipPath>
                        </defs>
                      </svg>
                      <span className='text-dream-primary text-base'>{t('leadsBlock.smaller')}</span>
                    </button>
                    <button 
                      onClick={() => {
                        if (viewMode === 'list') {
                          setFontSize(prev => Math.min(100, prev + 5));
                        } else {
                          setColumnWidth(prev => Math.min(100, prev + 5));
                        }
                      }}
                      className='flex items-center gap-2.5 cursor-pointer hover:opacity-80 transition-all duration-200 ease-in-out hover:scale-105 active:scale-95'
                    >
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <g clipPath="url(#clip0_4159_60011)">
                        <path d="M9.99996 0C4.48598 0 0 4.48598 0 9.99996C0 15.5139 4.48598 19.9999 9.99996 19.9999C15.5139 19.9999 19.9999 15.514 19.9999 9.99996C19.9999 4.48594 15.5139 0 9.99996 0ZM9.99996 18.7499C5.17523 18.7499 1.25 14.8247 1.25 9.99996C1.25 5.17523 5.17523 1.25 9.99996 1.25C14.8247 1.25 18.7499 5.1752 18.7499 9.99996C18.7499 14.8247 14.8247 18.7499 9.99996 18.7499ZM15.5468 9.99996C15.5468 10.3452 15.267 10.625 14.9218 10.625H10.625V14.9218C10.625 15.267 10.3451 15.5468 9.99996 15.5468C9.6548 15.5468 9.37496 15.267 9.37496 14.9218V10.625H5.07809C4.73293 10.625 4.45309 10.3452 4.45309 9.99996C4.45309 9.65477 4.73293 9.37496 5.07809 9.37496H9.37496V5.07809C9.37496 4.73289 9.6548 4.45309 9.99996 4.45309C10.3451 4.45309 10.625 4.73289 10.625 5.07809V9.37496H14.9218C15.267 9.37496 15.5468 9.6548 15.5468 9.99996Z" fill="var(--accent)"/>
                        </g>
                        <defs>
                        <clipPath id="clip0_4159_60011">
                        <rect width="20" height="20" fill="white"/>
                        </clipPath>
                        </defs>
                      </svg>
                      <span className='text-dream-primary text-base'>{t('leadsBlock.larger')}</span>
                    </button>
                  </div>
                  <div 
                    ref={sliderTrackRef}
                    className='relative w-full h-3.5 rounded-full bg-[var(--secondary)]'
                  >
                    <div 
                      className='absolute top-0 left-0 h-full rounded-full bg-[color-mix(in_srgb,var(--accent)_58%,var(--secondary))]'
                      style={{ 
                        width: `${viewMode === 'list' ? fontSize : columnWidth}%`,
                        transition: isDragging ? 'none' : 'width 0.1s ease-out'
                      }}
                    />
                    <svg
                      onMouseDown={handleSliderMouseDown}
                      onTouchStart={handleSliderTouchStart}
                      width="17"
                      height="39"
                      viewBox="0 0 17 39"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      className={`absolute top-1/2 -translate-y-1/2 z-20 cursor-grab active:cursor-grabbing ${isDragging ? 'scale-110' : ''}`}
                      style={{ 
                        left: `calc(${viewMode === 'list' ? fontSize : columnWidth}% - 8.5px)`,
                        transition: isDragging ? 'none' : 'left 0.1s ease-out'
                      }}
                    >
                      <path d="M8.5 0.5C9.50751 0.5 10.5068 0.966717 11.46 1.8916C12.4155 2.81878 13.2991 4.1844 14.0518 5.91113C15.5565 9.36323 16.5 14.1673 16.5 19.5C16.5 24.8327 15.5565 29.6368 14.0518 33.0889C13.2991 34.8156 12.4155 36.1812 11.46 37.1084C10.5068 38.0333 9.50751 38.5 8.5 38.5C7.49249 38.5 6.49322 38.0333 5.54004 37.1084C4.58451 36.1812 3.70094 34.8156 2.94824 33.0889C1.44348 29.6368 0.5 24.8327 0.5 19.5C0.5 14.1673 1.44348 9.36323 2.94824 5.91113C3.70094 4.1844 4.58451 2.81878 5.54004 1.8916C6.49322 0.966717 7.49249 0.5 8.5 0.5Z" fill="var(--primary)" stroke="color-mix(in srgb, var(--accent) 50%, transparent)"/>
                    </svg>
                  </div>
                </div>
                </div>,
                document.body
              )}
          </div>
        </div>
        </div>
        <div className="flex gap-4 flex-wrap px-5">
          <div className="relative flex items-center gap-0.5 p-0.5 shadow-[inset_0_0_0_1px_rgba(201,168,76,0.18)] bg-[var(--secondary)] rounded-md w-full md:w-auto order-last md:order-1 justify-between overflow-x-auto md:overflow-x-hidden scrollbar-hide">
            {/* Индикатор только для десктопа */}
            {buttonPositions[selectedTab] && (
              <div
                className="hidden md:block absolute top-0.5 left-0 bg-[var(--primary)] rounded-md transition-all duration-300 ease-in-out shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]"
                style={{
                  width: `${buttonPositions[selectedTab].width}px`,
                  height: 'calc(100% - 4px)',
                  transform: `translateX(${buttonPositions[selectedTab].left}px)`,
                }}
              />
            )}
            <button
              ref={tabButtonRefs.all}
              onClick={() => handleTabChange('all')}
              type="button"
              className={`relative z-10 rounded-sm px-2 py-1.5 md:py-1 md:px-3 text-base ${
                selectedTab === 'all'
                  ? 'bg-[var(--primary)] text-[var(--primary-foreground)] md:bg-transparent md:text-[var(--primary-foreground)]'
                  : 'text-[var(--muted-foreground)] hover:text-[color:var(--foreground)] md:transition-colors md:duration-300'
              }`}
            >
              <span className="whitespace-nowrap">{t('leadsBlock.all')} ({categoryCounts.all})</span>
            </button>
            <button
              ref={tabButtonRefs.leads}
              onClick={() => handleTabChange('leads')}
              type="button"
              className={`relative z-10 rounded-sm px-2 py-1.5 md:py-1 md:px-3 text-base ${
                selectedTab === 'leads'
                  ? 'bg-[var(--primary)] text-[var(--primary-foreground)] md:bg-transparent md:text-[var(--primary-foreground)]'
                  : 'text-[var(--muted-foreground)] hover:text-[color:var(--foreground)] md:transition-colors md:duration-300'
              }`}
            >
              <span className="whitespace-nowrap">{t('leadsBlock.reject')} ({categoryCounts.leads})</span>
            </button>
            <button
              ref={tabButtonRefs.inWork}
              onClick={() => handleTabChange('inWork')}
              type="button"
              className={`relative z-10 rounded-sm px-2 py-1.5 md:py-1 md:px-3 text-base ${
                selectedTab === 'inWork'
                  ? 'bg-[var(--primary)] text-[var(--primary-foreground)] md:bg-transparent md:text-[var(--primary-foreground)]'
                  : 'text-[var(--muted-foreground)] hover:text-[color:var(--foreground)] md:transition-colors md:duration-300'
              }`}
            >
              <span className="whitespace-nowrap">{t('leadsBlock.inProgress')} ({categoryCounts.inWork})</span>
            </button>
            {selectedProduct === 'RP' && (
              <button
                ref={tabButtonRefs.bought}
                onClick={() => handleTabChange('bought')}
                type="button"
                className={`relative z-10 rounded-sm px-2 py-1.5 md:py-1 md:px-3 text-base ${
                  selectedTab === 'bought'
                    ? 'bg-[var(--primary)] text-[var(--primary-foreground)] md:bg-transparent md:text-[var(--primary-foreground)]'
                    : 'text-[var(--muted-foreground)] hover:text-[color:var(--foreground)] md:transition-colors md:duration-300'
              }`}
            >
              <span className="whitespace-nowrap">{t('leadsBlock.bought')} ({categoryCounts.bought})</span>
              </button>
            )}
          </div>
          <div className="relative flex items-center flex-1 w-full md:w-auto min-w-0 order-5 md:order-2  md:min-w-25">

            <input
              type="text"
              placeholder={t('leadsBlock.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2 flex-1 w-full md:flex-1 rounded-sm border border-[color-mix(in_srgb,var(--primary)_42%,transparent)] bg-[var(--card)] text-[color:var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_45%,transparent)] text-base"
            />
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="absolute left-3 pointer-events-none"
            >
              <path
                d="M9.16667 15.8333C12.8486 15.8333 15.8333 12.8486 15.8333 9.16667C15.8333 5.48477 12.8486 2.5 9.16667 2.5C5.48477 2.5 2.5 5.48477 2.5 9.16667C2.5 12.8486 5.48477 15.8333 9.16667 15.8333Z"
                stroke="var(--accent)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M17.5 17.5L13.875 13.875"
                stroke="var(--accent)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          {}
          <div className="flex gap-4 w-full md:hidden order-1 flex-wrap">
            <button type="button" onClick={() => setIsCreateClientModalOpen(true)} className="cursor-pointer rounded-sm p-2 px-6 bg-[var(--primary)] text-[var(--primary-foreground)] flex-1 min-w-40 text-base">
              <span className="text-nowrap">{t('leadsBlock.addLead')}</span>
            </button>
            <button type="button" className="rounded-sm relative p-2 px-6 bg-[var(--card)] border border-[color-mix(in_srgb,var(--accent)_40%,transparent)] text-[var(--accent)] flex-1 min-w-40 text-base">
              <span className="text-nowrap">{t('leadsBlock.getLead')}</span>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="absolute -top-2 -right-2">
                <g clipPath="url(#clip0_3210_43694)">
                <path d="M23.4337 8.82459L15.66 8.10361L12.5721 0.933199C12.3559 0.431121 11.644 0.431121 11.4278 0.933199L8.33995 8.10365L0.566262 8.82459C0.0219507 8.87507 -0.198033 9.55209 0.212638 9.91284L6.07791 15.0654L4.36144 22.6815C4.24126 23.2147 4.81716 23.6331 5.28718 23.354L12 19.3681L18.7128 23.354C19.1828 23.6331 19.7588 23.2147 19.6386 22.6815L17.9221 15.0654L23.7873 9.91284C24.198 9.55209 23.978 8.87507 23.4337 8.82459Z" fill="#FFDC64"/>
                <path d="M12.5721 0.933199C12.3559 0.431121 11.644 0.431121 11.4278 0.933199L8.33995 8.10365L0.566262 8.82459C0.0219507 8.87507 -0.198033 9.55209 0.212638 9.91284L6.07791 15.0654L4.36144 22.6815C4.24126 23.2147 4.81716 23.6331 5.28718 23.354L6.78544 22.4644C6.99281 13.9284 10.9589 7.91733 14.099 4.47863L12.5721 0.933199Z" fill="#FFC850"/>
                </g>
                <defs>
                <clipPath id="clip0_3210_43694">
                <rect width="24" height="24" fill="white"/>
                </clipPath>
                </defs>
              </svg>
            </button>
          </div>

          {}
          <div className="flex gap-4 w-full md:hidden order-3 flex-wrap">
            <button
              type="button"
              onClick={() => setIsFiltersMenuOpen(!isFiltersMenuOpen)}
              className="rounded-sm p-2 px-4 bg-[var(--primary)] text-[var(--primary-foreground)] flex items-center justify-center gap-2 relative flex-1 min-w-40 cursor-pointer text-base"
            >
              <span className="truncate">{t('leadsBlock.filters')}</span>
              <svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg" className="flex-shrink-0 text-[var(--primary-foreground)]">
                <path fillRule="evenodd" clipRule="evenodd" d="M12.6009 23.2402H4.72461C4.20711 23.2402 3.78711 22.8202 3.78711 22.3027C3.78711 21.7852 4.20711 21.3652 4.72461 21.3652H12.6009C13.1184 21.3652 13.5384 21.7852 13.5384 22.3027C13.5384 22.8202 13.1184 23.2402 12.6009 23.2402Z" fill="currentColor"/>
                <path fillRule="evenodd" clipRule="evenodd" d="M23.9883 11.125H16.1133C15.5958 11.125 15.1758 10.705 15.1758 10.1875C15.1758 9.67 15.5958 9.25 16.1133 9.25H23.9883C24.5058 9.25 24.9258 9.67 24.9258 10.1875C24.9258 10.705 24.5058 11.125 23.9883 11.125Z" fill="currentColor"/>
                <mask id="mask0_3487_17858" style={{ maskType: 'luminance' }} maskUnits="userSpaceOnUse" x="3" y="6" width="9" height="8">
                  <path fillRule="evenodd" clipRule="evenodd" d="M3.75 6.25H11.5322V13.9895H3.75V6.25Z" fill="white"/>
                </mask>
                <g mask="url(#mask0_3487_17858)">
                  <path fillRule="evenodd" clipRule="evenodd" d="M7.64125 8.125C6.53 8.125 5.625 9.02 5.625 10.1213C5.625 11.2213 6.53 12.115 7.64125 12.115C8.75375 12.115 9.6575 11.2213 9.6575 10.1213C9.6575 9.02 8.75375 8.125 7.64125 8.125ZM7.64125 13.99C5.49625 13.99 3.75 12.255 3.75 10.1213C3.75 7.9875 5.49625 6.25 7.64125 6.25C9.7875 6.25 11.5325 7.9875 11.5325 10.1213C11.5325 12.255 9.7875 13.99 7.64125 13.99Z" fill="currentColor"/>
                </g>
                <path fillRule="evenodd" clipRule="evenodd" d="M21.7343 20.2598C20.6218 20.2598 19.7168 21.1548 19.7168 22.2548C19.7168 23.356 20.6218 24.2498 21.7343 24.2498C22.8455 24.2498 23.7493 23.356 23.7493 22.2548C23.7493 21.1548 22.8455 20.2598 21.7343 20.2598ZM21.7343 26.1248C19.588 26.1248 17.8418 24.3885 17.8418 22.2548C17.8418 20.121 19.588 18.3848 21.7343 18.3848C23.8793 18.3848 25.6243 20.121 25.6243 22.2548C25.6243 24.3885 23.8793 26.1248 21.7343 26.1248Z" fill="currentColor"/>
              </svg>
              <div className="absolute top-0.5 right-1 rounded-full w-2.5 h-2.5 bg-[color-mix(in_srgb,#b4ccc3_85%,transparent)] shadow-[inset_0_0_0_1px_rgba(201,168,76,0.25)]" aria-hidden />
            </button>
            <button type="button" className="rounded-sm p-2 px-4 bg-[var(--primary)] text-[var(--primary-foreground)] flex-1 min-w-40 hidden">
              <span className="text-nowrap">{t('leadsBlock.newButton')}</span>
            </button>
          </div>

          {}
          <div className="relative hidden md:block md:order-3">
            <button
              type="button"
              ref={filtersMenuButtonRef}
              onClick={() => {
                if (!isFiltersMenuOpen) updateFiltersMenuPosition();
                setIsFiltersMenuOpen(!isFiltersMenuOpen);
              }}
              className="cursor-pointer rounded-sm px-2.5 bg-[var(--primary)] text-[var(--primary-foreground)] flex items-center gap-2 relative h-full text-base"
            >
              <span>{t('leadsBlock.filters')}</span>
              <svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-[var(--primary-foreground)]">
                <path fillRule="evenodd" clipRule="evenodd" d="M12.6009 23.2402H4.72461C4.20711 23.2402 3.78711 22.8202 3.78711 22.3027C3.78711 21.7852 4.20711 21.3652 4.72461 21.3652H12.6009C13.1184 21.3652 13.5384 21.7852 13.5384 22.3027C13.5384 22.8202 13.1184 23.2402 12.6009 23.2402Z" fill="currentColor"/>
                <path fillRule="evenodd" clipRule="evenodd" d="M23.9883 11.125H16.1133C15.5958 11.125 15.1758 10.705 15.1758 10.1875C15.1758 9.67 15.5958 9.25 16.1133 9.25H23.9883C24.5058 9.25 24.9258 9.67 24.9258 10.1875C24.9258 10.705 24.5058 11.125 23.9883 11.125Z" fill="currentColor"/>
                <mask id="mask0_3487_17858_desktop" style={{ maskType: 'luminance' }} maskUnits="userSpaceOnUse" x="3" y="6" width="9" height="8">
                  <path fillRule="evenodd" clipRule="evenodd" d="M3.75 6.25H11.5322V13.9895H3.75V6.25Z" fill="white"/>
                </mask>
                <g mask="url(#mask0_3487_17858_desktop)">
                  <path fillRule="evenodd" clipRule="evenodd" d="M7.64125 8.125C6.53 8.125 5.625 9.02 5.625 10.1213C5.625 11.2213 6.53 12.115 7.64125 12.115C8.75375 12.115 9.6575 11.2213 9.6575 10.1213C9.6575 9.02 8.75375 8.125 7.64125 8.125ZM7.64125 13.99C5.49625 13.99 3.75 12.255 3.75 10.1213C3.75 7.9875 5.49625 6.25 7.64125 6.25C9.7875 6.25 11.5325 7.9875 11.5325 10.1213C11.5325 12.255 9.7875 13.99 7.64125 13.99Z" fill="currentColor"/>
                </g>
                <path fillRule="evenodd" clipRule="evenodd" d="M21.7343 20.2598C20.6218 20.2598 19.7168 21.1548 19.7168 22.2548C19.7168 23.356 20.6218 24.2498 21.7343 24.2498C22.8455 24.2498 23.7493 23.356 23.7493 22.2548C23.7493 21.1548 22.8455 20.2598 21.7343 20.2598ZM21.7343 26.1248C19.588 26.1248 17.8418 24.3885 17.8418 22.2548C17.8418 20.121 19.588 18.3848 21.7343 18.3848C23.8793 18.3848 25.6243 20.121 25.6243 22.2548C25.6243 24.3885 23.8793 26.1248 21.7343 26.1248Z" fill="currentColor"/>
              </svg>
              <div className="absolute top-0.5 right-1 rounded-full w-2.5 h-2.5 bg-[color-mix(in_srgb,#b4ccc3_85%,transparent)] shadow-[inset_0_0_0_1px_rgba(201,168,76,0.25)]" aria-hidden />
            </button>
            {isFiltersMenuOpen && createPortal(
              <>
                {/* Backdrop для мобильной версии */}
                <div 
                  className="fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden"
                  onClick={() => setIsFiltersMenuOpen(false)}
                />
                <div
                  ref={filtersMenuRef}
                  className="filters-slide-in fixed left-0 top-0 shadow-[0_18px_50px_rgba(0,0,0,0.38)] bg-[var(--card)] text-[color:var(--foreground)] border border-[var(--border)] z-50 md:z-30 py-5 px-6 md:rounded-[6px] w-full h-full md:w-[333px] md:h-auto md:max-h-[calc(100dvh-7rem)] overflow-y-auto"
                  style={filtersMenuPosition && typeof window !== 'undefined' && window.innerWidth >= 768 ? filtersMenuPosition : undefined}
                >
                <div className='flex flex-col gap-5'>
                  <div className='flex items-center justify-between'>
                    <span className='font-normal text-xl leading-none tracking-normal text-[color:var(--foreground)]'>{t('leadsBlock.filter')}</span>
                    <button
                      onClick={() => setIsFiltersMenuOpen(false)}
                      className="cursor-pointer rounded-[4px] p-1.5 text-[color:var(--muted-foreground)] hover:bg-[var(--secondary)] transition-colors"
                    >
                      <svg width="26" height="26" viewBox="0 0 32 26" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M16 15.7254L24.2746 24L27 21.2746L18.7254 13L27 4.72543L24.2746 2L16 10.2746L7.72543 2L5 4.72543L13.2746 13L5 21.2746L7.72543 24L16 15.7254Z" fill="currentColor"/>
                      </svg>
                    </button>
                  </div>
                  <FilterDropdown
                    title={t('leadsBlock.funnelStage')}
                    options={stageOptions}
                    selectedItems={selectedStages}
                    onToggle={toggleStage}
                    placeholder={t('leadsBlock.selectStages')}
                  />
                  <div className='flex flex-col gap-3'>
                    <span className='text-[color:var(--muted-foreground)] font-normal text-base leading-none'>{t('leadsBlock.budget')}</span>
                    <div className='flex gap-2.5'>
                      <div className='flex-1 relative'>
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder={t('leadsBlock.from')}
                          value={minBudget}
                          onChange={(e) => setMinBudget(sanitizeBudgetValue(e.target.value))}
                          className='w-full h-11 px-4 pr-8 border border-[var(--border)] bg-[var(--secondary)] rounded-[4px] text-[color:var(--foreground)] placeholder:text-[color:var(--muted-foreground)]/50 focus:outline-none focus:ring-2 focus:ring-[color:var(--primary)]/30'
                        />
                        <span className='absolute right-4 top-1/2 -translate-y-1/2 text-[color:var(--primary)]'>$</span>
                      </div>
                      <div className='flex-1 relative'>
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder={t('leadsBlock.to')}
                          value={maxBudget}
                          onChange={(e) => setMaxBudget(sanitizeBudgetValue(e.target.value))}
                          className='w-full h-11 px-4 pr-8 border border-[var(--border)] bg-[var(--secondary)] rounded-[4px] text-[color:var(--foreground)] placeholder:text-[color:var(--muted-foreground)]/50 focus:outline-none focus:ring-2 focus:ring-[color:var(--primary)]/30'
                        />
                        <span className='absolute right-4 top-1/2 -translate-y-1/2 text-[color:var(--primary)]'>$</span>
                      </div>
                    </div>
                  </div>
                  <div className='flex justify-center'>
                    <button
                      type="button"
                      disabled
                      className='rounded-[4px] py-3 bg-[var(--primary)] text-[color:var(--gold-btn-text)] flex justify-center w-full cursor-not-allowed font-normal opacity-95'
                    >
                      <span>{t('leadsBlock.showingClients').replace('{{count}}', String(filteredLeadsForProduct.length))}</span>
                    </button>
                  </div>
                </div>
              </div>
              </>,
              document.body
            )}
          </div>
          <button type="button" onClick={() => setIsCreateClientModalOpen(true)} className="cursor-pointer rounded-sm p-2 px-6 bg-[var(--primary)] text-[color:var(--gold-btn-text)] hidden md:block md:order-4 text-base">
            <span className="text-nowrap">{t('leadsBlock.addLead')}</span>
          </button>
          <button
            type="button"
            className="rounded-sm relative p-2 px-6 hidden md:block md:order-5 cursor-default border border-[var(--border)] bg-[var(--card)] text-[color:var(--muted-foreground)] text-base"
          >
            <span className="text-nowrap">{t('leadsBlock.getLeadAlt')}</span>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="absolute -top-2 -right-2">
              <g clipPath="url(#clip0_3210_43694_desktop)">
              <path d="M23.4337 8.82459L15.66 8.10361L12.5721 0.933199C12.3559 0.431121 11.644 0.431121 11.4278 0.933199L8.33995 8.10365L0.566262 8.82459C0.0219507 8.87507 -0.198033 9.55209 0.212638 9.91284L6.07791 15.0654L4.36144 22.6815C4.24126 23.2147 4.81716 23.6331 5.28718 23.354L12 19.3681L18.7128 23.354C19.1828 23.6331 19.7588 23.2147 19.6386 22.6815L17.9221 15.0654L23.7873 9.91284C24.198 9.55209 23.978 8.87507 23.4337 8.82459Z" fill="#FFDC64"/>
              <path d="M12.5721 0.933199C12.3559 0.431121 11.644 0.431121 11.4278 0.933199L8.33995 8.10365L0.566262 8.82459C0.0219507 8.87507 -0.198033 9.55209 0.212638 9.91284L6.07791 15.0654L4.36144 22.6815C4.24126 23.2147 4.81716 23.6331 5.28718 23.354L6.78544 22.4644C6.99281 13.9284 10.9589 7.91733 14.099 4.47863L12.5721 0.933199Z" fill="#FFC850"/>
              </g>
              <defs>
              <clipPath id="clip0_3210_43694_desktop">
              <rect width="24" height="24" fill="white"/>
              </clipPath>
              </defs>
            </svg>
          </button>
        </div>
      <div className="w-full min-w-0 flex-1 min-h-0 overflow-y-auto flex flex-col">
        {}
        {viewMode === 'grid' ? (
          <>
            {}
            <div className="hidden md:flex gap-4 px-5 overflow-x-auto pb-5">
              {statusLabels.map((status: string, statusIndex: number) => {
                // В grid режиме показываем все столбцы, но фильтруем карточки по категории
                // Карточки в процессе анимации остаются видимыми в своем столбце, чтобы анимация успела проиграться
                const recordsInStatus = filteredLeadRecords
                  .filter(
                    record => {
                      const isInAnimation = disappearingCards.has(record.id);
                      // Если карточка в процессе анимации, используем старую позицию для отображения в старом столбце
                      const displayPosition = isInAnimation && animationOldPositions[record.id] 
                        ? animationOldPositions[record.id] 
                        : (sliderPositions[record.id] || 1);
                      const matchesPosition = displayPosition === statusIndex + 1;
                      const matchesCategory = selectedTab === 'all' || !record.category || record.category === selectedTab;
                      const matchesProduct = record.type === selectedProduct;
                      
                      // Показываем карточку если:
                      // 1. Она соответствует позиции и продукту
                      // 2. И либо соответствует категории, либо находится в процессе анимации (чтобы анимация успела проиграться)
                      // Важно: карточка в процессе анимации должна остаться в своем старом столбце
                      if (isInAnimation) {
                        // Если карточка в процессе анимации, показываем её в старом столбце (старая позиция)
                        return matchesPosition && matchesProduct;
                      }
                      return matchesPosition && matchesProduct && matchesCategory;
                    }
                  )
                  .sort((a, b) => compareLeadListOrder(a, b, pinnedLeadId));
                
                return (
                  <div
                    key={statusIndex}
                    className="flex-shrink-0"
                    style={{ width: `${calculatedColumnWidth}px` }}
                    onDragOver={(e) => handleDragOver(e, statusIndex)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, statusIndex)}
                  >
                    <div className={`rounded-lg p-4 min-h-[400px] transition-all h-full duration-200 bg-[var(--secondary)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_8%,transparent)] ${
                      draggedOverColumn === statusIndex ? 'bg-[color-mix(in_srgb,var(--primary)_12%,var(--secondary))] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_35%,transparent)]' : ''
                    }`}>
                      <div className="flex items-center justify-center h-20 rounded-md mb-4 px-2 bg-[var(--card)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_12%,transparent)]">
                        <h3 className="text-base font-normal text-[var(--muted-foreground)] text-center line-clamp-3 break-words">{status} ({recordsInStatus.length})</h3>
                      </div>
                      <div className="flex flex-col gap-3">
                        {recordsInStatus.map((record) => (
                          <div 
                            key={record.id}
                            className={`transition-all duration-300 ${
                              disappearingCards.has(record.id) 
                                ? `opacity-0 transform ${cardSwipeDirections[record.id] === 'right' ? 'translate-x-full' : 'translate-x-[-100%]'}` 
                                : 'opacity-100 transform translate-x-0'
                            }`}
                          >
                            {renderLeadRecord(record, true)}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {}
            <div className="flex md:hidden flex-col gap-4 px-5">
            {filteredLeadRecords
                .filter(record => {
                  // Показываем карточку если:
                  // 1. Режим t('leadsBlock.all') ИЛИ
                  // 2. Категория карточки совпадает с выбранной вкладкой ИЛИ
                  // 3. Карточка находится в процессе анимации исчезновения (чтобы анимация успела проиграться)
                  const isInAnimation = disappearingCards.has(record.id);
                  const matchesCategory = !record.category || record.category === selectedTab;
                  return (selectedTab === 'all' || matchesCategory || isInAnimation) && record.type === selectedProduct;
                })
                .map((record) => (
                  <div 
                    key={record.id}
                    className={`transition-all duration-300 ${
                      disappearingCards.has(record.id) 
                        ? `opacity-0 transform ${cardSwipeDirections[record.id] === 'right' ? 'translate-x-full' : 'translate-x-[-100%]'}` 
                        : 'opacity-100 transform translate-x-0'
                    }`}
                  >
                    {renderLeadRecord(record, false)}
                  </div>
                ))}
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-4 px-5 pt-1">
            {filteredLeadRecords
              .filter(record => {
                // Показываем карточку если:
                // 1. Режим t('leadsBlock.all') ИЛИ
                // 2. Категория карточки совпадает с выбранной вкладкой ИЛИ
                // 3. Карточка находится в процессе анимации исчезновения (чтобы анимация успела проиграться)
                const isInAnimation = disappearingCards.has(record.id);
                const matchesCategory = !record.category || record.category === selectedTab;
                return (selectedTab === 'all' || matchesCategory || isInAnimation) && record.type === selectedProduct;
              })
              .sort((a, b) => compareLeadListOrder(a, b, pinnedLeadId))
              .map((record) => (
                <div 
                  key={record.id}
                  className={`transition-all duration-300 ${
                    disappearingCards.has(record.id) 
                      ? `opacity-0 transform ${cardSwipeDirections[record.id] === 'right' ? 'translate-x-full' : 'translate-x-[-100%]'}` 
                      : 'opacity-100 transform translate-x-0'
                  }`}
                >
                  {renderLeadRecord(record, false)}
                </div>
              ))}
          </div>
        )}
      </div>
      </div>

      <AddLeadModal
        isOpen={isAddLeadModalOpen}
        onClose={() => setIsAddLeadModalOpen(false)}
        onSubmit={async (leadData) => {
          const currentUserId = localStorage.getItem('userId') || '690ca643abbceba815ba7090';

          const productTypeMap: Record<ProductTab, ProductType> = {
            RP: ProductType.SALES,
            Net: ProductType.NETWORK,
            Owner: ProductType.OWNER,
            Agent: ProductType.AGENT,
          };
          const createLeadDto = {
            name: `${leadData.name} ${leadData.lastName}`.trim(),
            phone: leadData.phone,
            email: leadData.email,
            productType: productTypeMap[selectedProduct],
            assignedTo: currentUserId,
            source: t('leadsBlock.manualAdd'),
          };

          try {
            // `[phase 4]` POST /leads принимает только
            // requesterName/requesterPhone/productType (см. CreateLeadV2Payload
            // докстринг) — email/source в тело создания не входят, честный
            // пробел. assignedTo применяется отдельным вызовом assign после
            // создания (тот же приём, что LeadsContext.ADD_LEAD).
            const created = await leadsApiV2.create(
              {
                requesterName: createLeadDto.name,
                requesterPhone: createLeadDto.phone,
                productType: mapProductTypeCrmToV2(createLeadDto.productType),
              },
              newIdempotencyKey(),
            );
            if (createLeadDto.assignedTo) {
              await leadsApiV2.assign(created.id, createLeadDto.assignedTo);
            }
            setIsAddLeadModalOpen(false);
            await onLoadLeads();
          } catch (error: any) {
            console.error('Error creating lead:', error);
            console.error('Error response:', error.response?.data);
            let errorMessage = error.response?.data?.message || error.message || t('leadsBlock.unknownError');
            // Улучшенное сообщение для ошибки дубликата
            if (errorMessage.includes(t('leadsBlock.alreadyExists')) || error.response?.status === 409) {
              const duplicateHandled = await resolveDuplicateLeadForUser(
                { phone: createLeadDto.phone },
                currentUserId
              );
              if (duplicateHandled.assignedToCurrentUser) {
                alert(duplicateHandled.message || t('leadsBlock.leadAssignedToYou'));
                setIsAddLeadModalOpen(false);
                await onLoadLeads();
                return;
              }
              errorMessage = t('leadsBlock.leadExistsError');
            }
            alert(t('leadsBlock.createLeadError') + errorMessage);
          }
        } } selectedProduct={selectedProduct}      />
      <CreateClientModal
        isOpen={isCreateClientModalOpen}
        onClose={() => {
          setIsCreateClientModalOpen(false);
          setInitialStageForNewClient(null);
        }}
        initialProductType={selectedProduct}
        onSubmit={(clientName) => {
          // Здесь можно добавить логику обработки созданного клиента
        }}
        initialStage={initialStageForNewClient?.stage}
        onLeadCreated={async () => {
          // После создания клиента обновляем список лидов
          await onLoadLeads();
          // Сбрасываем начальную стадию
          setInitialStageForNewClient(null);
        }}
      />
      <LeadViewModal
        isOpen={isLeadViewModalOpen}
        onClose={() => {
          // Принудительно закрываем модалку
          setIsLeadViewModalOpen(false);
          setSelectedLead(null);
          setInitialTab('info');
          lastOpenedLeadIdRef.current = null;
          // Очищаем URL параметры
          const newParams = new URLSearchParams(searchParams);
          newParams.delete('modal');
          newParams.delete('leadId');
          setSearchParams(newParams, { replace: true });
        }}
        onLeadDeleted={async (leadId: string) => {
          setIsLeadViewModalOpen(false);
          setSelectedLead(null);
          setInitialTab('tasks');
          lastOpenedLeadIdRef.current = null;
          const newParams = new URLSearchParams(searchParams);
          newParams.delete('modal');
          newParams.delete('leadId');
          newParams.delete('tab');
          newParams.delete('editing');
          setSearchParams(newParams, { replace: true });
          // Вызываем обработчик удаления, если он передан
          if (onLeadDeleted) {
            onLeadDeleted(leadId);
          }
          // Обновляем список лидов после удаления
          if (onLoadLeads) {
            await onLoadLeads();
          }
        }}
        lead={selectedLead}
        onOpenNewTaskModal={onOpenNewTaskModal}
        onOpenTaskManagementModal={onOpenTaskManagementModal}
        initialTab={initialTab}
        onUpdateLeadAfterSync={onUpdateLeadAfterSync}
      />
      {/* Рендерим меню контактов через Portal для отображения поверх всех элементов */}
      {openContactMenu && contactMenuPosition && (() => {
        const recordId = openContactMenu;
        const backendLead = backendLeads.find(lead => lead._id === recordId);

        if (!backendLead) return null;

        return createPortal(
          <div
            ref={contactMenuRef}
            className="fixed bg-[var(--card)] text-[color:var(--foreground)] shadow-lg z-[9999] min-w-[255px] flex flex-col gap-2 py-2.5 px-5 rounded-lg border border-[color:var(--border)]"
            style={{
              top: `${contactMenuPosition.top}px`,
              left: contactMenuPosition.left !== undefined ? `${contactMenuPosition.left}px` : undefined,
              right: contactMenuPosition.right !== undefined ? `${contactMenuPosition.right}px` : undefined,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Позвонить: номер телефона и кнопка t('leadsBlock.copyToClipboard') */}
            <div className="flex flex-row items-center gap-3">
              <svg width="23" height="23" viewBox="0 0 23 23" fill="none" xmlns="http://www.w3.org/2000/svg">
                <g clipPath="url(#clip0_4687_62326)">
                <path d="M22.3733 16.8797L19.1636 13.67C18.0172 12.5236 16.0685 12.9822 15.61 14.4724C15.2661 15.5041 14.1197 16.0773 13.088 15.848C10.7954 15.2748 7.70029 12.2944 7.12713 9.88708C6.78323 8.85534 7.47102 7.70901 8.50272 7.36516C9.99295 6.90663 10.4515 4.95787 9.30515 3.81154L6.09543 0.601822C5.17837 -0.200607 3.80277 -0.200607 3.00035 0.601822L0.822322 2.77985C-1.3557 5.0725 1.05159 11.148 6.43933 16.5358C11.8271 21.9235 17.9026 24.4455 20.1953 22.1528L22.3733 19.9748C23.1758 19.0577 23.1758 17.6821 22.3733 16.8797Z" fill="var(--accent)"/>
                </g>
                <defs>
                <clipPath id="clip0_4687_62326">
                <rect width="23" height="23" fill="white"/>
                </clipPath>
                </defs>
              </svg>

              <span className="text-base font-medium text-[var(--foreground)]">
                {backendLead.phone || t('leadsBlock.noPhone')}
              </span>
              <button
                className="flex items-center cursor-pointer"
                onClick={async (e) => {
                  e.stopPropagation();
                  leadsApiV2.recordContactAction(recordId, 'call').catch(() => {});
                  if (backendLead.phone) {
                    try {
                      // Используем Clipboard API, если доступен
                      if (navigator.clipboard && navigator.clipboard.writeText) {
                        await navigator.clipboard.writeText(backendLead.phone);
                      } else {
                        // Fallback метод для старых браузеров или небезопасных контекстов
                        const textArea = document.createElement('textarea');
                        textArea.value = backendLead.phone;
                        textArea.style.position = 'fixed';
                        textArea.style.left = '-999999px';
                        textArea.style.top = '-999999px';
                        document.body.appendChild(textArea);
                        textArea.focus();
                        textArea.select();
                        try {
                          document.execCommand('copy');
                        } catch (err) {
                          console.error('Failed to copy text:', err);
                        }
                        document.body.removeChild(textArea);
                      }
                    } catch (err) {
                      console.error('Failed to copy text:', err);
                    }
                  }
                  setOpenContactMenu(null);
                  setContactMenuPosition(null);
                }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M7.375 11.1249C7.375 8.88578 7.375 7.76621 8.07061 7.07061C8.76621 6.375 9.88578 6.375 12.1249 6.375H14.4999C16.739 6.375 17.8585 6.375 18.5541 7.07061C19.2498 7.76621 19.2498 8.88578 19.2498 11.1249V15.0832C19.2498 17.3223 19.2498 18.4418 18.5541 19.1374C17.8585 19.8331 16.739 19.8331 14.4999 19.8331H12.1249C9.88578 19.8331 8.76621 19.8331 8.07061 19.1374C7.375 18.4418 7.375 17.3223 7.375 15.0832V11.1249Z" stroke="var(--accent)" strokeWidth="1.18748"/>
                  <path d="M7.37495 17.4581C6.0633 17.4581 5 16.3948 5 15.0831V10.3332C5 7.3477 5 5.85495 5.92748 4.92748C6.85495 4 8.3477 4 11.3332 4H14.4998C15.8115 4 16.8748 5.0633 16.8748 6.37495" stroke="var(--accent)" strokeWidth="1.18748"/>
                </svg>

              </button>
            </div>
            {/* Написать: WhatsApp, Telegram и Email (если есть) */}
            {(backendLead as any).telegram && (
            <a
                href={`https://t.me/${((backendLead as any).telegram as string).replace(/^@/, '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer w-full bg-[var(--secondary)] text-[var(--accent)] shadow-[inset_0_0_0_1px_rgba(201,168,76,0.15)] hover:bg-[color-mix(in_srgb,var(--primary)_12%,var(--secondary))]"
              onClick={(e) => {
                e.stopPropagation();
                leadsApiV2.recordContactAction(recordId, 'chat').catch(() => {});
                setOpenContactMenu(null);
                setContactMenuPosition(null);
              }}
            >
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8.63241 13.916L8.2685 19.0346C8.78916 19.0346 9.01466 18.811 9.28508 18.5424L11.7262 16.2095L16.7843 19.9137C17.712 20.4307 18.3656 20.1585 18.6158 19.0603L21.936 3.50263L21.9369 3.50171C22.2312 2.13038 21.441 1.59413 20.5372 1.93055L1.02133 9.4023C-0.310587 9.9193 -0.29042 10.6618 0.794913 10.9982L5.78433 12.5501L17.3737 5.29838C17.9192 4.93721 18.4151 5.13705 18.0072 5.49821L8.63241 13.916Z" fill="var(--accent)"/>
              </svg>

              <span>Telegram</span>
            </a>
            )}
            <a
              href={`https://wa.me/${backendLead.phone?.replace(/\D/g, '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2 bg-[color-mix(in_srgb,var(--primary)_18%,var(--secondary))] text-[var(--accent)] rounded-lg cursor-pointer w-full shadow-[inset_0_0_0_1px_rgba(201,168,76,0.12)] hover:bg-[color-mix(in_srgb,var(--primary)_26%,var(--secondary))]"
              onClick={(e) => {
                e.stopPropagation();
                leadsApiV2.recordContactAction(recordId, 'chat').catch(() => {});
                setOpenContactMenu(null);
                setContactMenuPosition(null);
              }}
            >
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
                <g clipPath="url(#clip0_4687_62526)">
                <path fillRule="evenodd" clipRule="evenodd" d="M18.2954 3.67408C16.3659 1.74225 13.7997 0.677891 11.0658 0.676758C5.43249 0.676758 0.847759 5.26136 0.845493 10.8962C0.844738 12.6975 1.3153 14.4559 2.20971 16.0058L0.759766 21.3018L6.17773 19.8805C7.6706 20.6949 9.35129 21.124 11.0617 21.1245H11.066C16.6987 21.1245 21.2839 16.5395 21.2861 10.9044C21.2872 8.17346 20.2251 5.60579 18.2954 3.67408ZM11.0658 19.3985H11.0623C9.53811 19.3979 8.04322 18.9882 6.7388 18.2144L6.42875 18.0303L3.21364 18.8737L4.0718 15.739L3.86975 15.4176C3.0194 14.0651 2.57037 12.5019 2.57113 10.8969C2.57289 6.21331 6.38368 2.40289 11.0692 2.40289C13.3382 2.40365 15.4711 3.28837 17.0748 4.89403C18.6786 6.49969 19.5613 8.63395 19.5606 10.9038C19.5586 15.5877 15.748 19.3985 11.0658 19.3985ZM15.7254 13.0364C15.4701 12.9085 14.2145 12.2909 13.9803 12.2056C13.7464 12.1203 13.576 12.0779 13.4059 12.3335C13.2356 12.589 12.7463 13.1643 12.5972 13.3346C12.4482 13.5051 12.2994 13.5265 12.044 13.3986C11.7886 13.2708 10.9658 13.001 9.99028 12.131C9.2312 11.4539 8.71872 10.6176 8.56967 10.3621C8.42088 10.1063 8.56841 9.98142 8.68171 9.84093C8.95815 9.49765 9.23497 9.13774 9.32007 8.96742C9.4053 8.79697 9.36262 8.6478 9.29867 8.52002C9.23497 8.39225 8.72426 7.13529 8.51151 6.62382C8.30405 6.12607 8.0937 6.19329 7.93685 6.18549C7.78805 6.17806 7.61773 6.17655 7.44741 6.17655C7.27721 6.17655 7.00051 6.24037 6.76637 6.49617C6.53235 6.75184 5.87271 7.36956 5.87271 8.62652C5.87271 9.88348 6.78777 11.0978 6.91542 11.2682C7.04306 11.4387 8.7162 14.0181 11.2778 15.1241C11.8871 15.3874 12.3627 15.5444 12.7337 15.6621C13.3455 15.8565 13.902 15.829 14.3421 15.7633C14.8328 15.6899 15.8529 15.1455 16.0659 14.549C16.2786 13.9525 16.2786 13.4412 16.2147 13.3346C16.151 13.2281 15.9806 13.1643 15.7254 13.0364Z" fill="var(--accent)"/>
                </g>
                <defs>
                <clipPath id="clip0_4687_62526">
                <rect width="22" height="22" fill="white"/>
                </clipPath>
                </defs>
              </svg>

              <span>WhatsApp</span>
            </a>
            {backendLead.email && (
              <a
                href={`mailto:${backendLead.email}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer w-full bg-[var(--secondary)] text-[var(--accent)] shadow-[inset_0_0_0_1px_rgba(201,168,76,0.15)] hover:bg-[color-mix(in_srgb,var(--primary)_12%,var(--secondary))]"
                onClick={(e) => {
                  e.stopPropagation();
                  leadsApiV2.recordContactAction(recordId, 'chat').catch(() => {});
                  setOpenContactMenu(null);
                  setContactMenuPosition(null);
                }}
              >
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M19.25 3.66667H2.75C1.64543 3.66667 0.75 4.5621 0.75 5.66667V16.3333C0.75 17.4379 1.64543 18.3333 2.75 18.3333H19.25C20.3546 18.3333 21.25 17.4379 21.25 16.3333V5.66667C21.25 4.5621 20.3546 3.66667 19.25 3.66667Z" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M0.75 5.66667L11 12.8333L21.25 5.66667" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span>{t('common.mail')}</span>
              </a>
            )}
          </div>,
          document.body
        );
      })()}
      {/* Рендерим tooltips через Portal для отображения поверх всех элементов */}
      {activeTooltip && createPortal(
        <div
          className="fixed px-3 py-1.5 bg-[var(--card)] text-[var(--foreground)] text-base rounded-md pointer-events-none whitespace-nowrap shadow-[inset_0_0_0_1px_rgba(201,168,76,0.18)] z-[999999]"
          style={{
            top: `${activeTooltip.position.top}px`,
            left: `${activeTooltip.position.left}px`,
            transform: 'translateX(-50%)',
            zIndex: 999999
          }}
        >
          {activeTooltip.text}
        </div>,
        document.body
      )}

      {/* Редактор тега лида: выбор из недавних или ввод своего */}
      {openTagEditor && tagEditorAnchor && (() => {
        const leadId = openTagEditor.leadId;
        const slotIndex = openTagEditor.slotIndex;
        const currentLead = backendLeads.find((l) => l._id === leadId);
        const currentTags: string[] = [...(currentLead?.tags ?? [])];
        const currentSlotValue = currentTags[slotIndex];

        const applyTag = async (value: string) => {
          const trimmed = value.trim().slice(0, 128);
          let newTags: string[];
          if (!trimmed) {
            newTags = currentTags.filter((_, i) => i !== slotIndex);
          } else {
            const next = [...currentTags];
            next[slotIndex] = trimmed;
            newTags = next.filter(Boolean).slice(0, 2);
          }
          try {
            const updated = await leadsApiV2.update(leadId, { tags: newTags });
            const updatedTags = updated.tags ?? newTags;
            if (onUpdateLead) onUpdateLead(leadId, { tags: updatedTags }, ['tags']);
            if (trimmed) addRecentLeadTag(trimmed);
          } catch (_) {}
          setOpenTagEditor(null);
          setTagEditorAnchor(null);
        };

        return createPortal(
          <div
            ref={tagEditorRef}
            className="fixed bg-[var(--card)] text-[color:var(--foreground)] rounded-xl shadow-lg border border-[color:var(--border)] py-3 px-3 z-[999998] min-w-[11rem] max-w-[15rem]"
            style={{
              top: `${tagEditorAnchor.top}px`,
              left: `${tagEditorAnchor.left}px`,
              zIndex: 999998,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              ref={tagEditorInputRef}
              type="text"
              placeholder={t('leadsBlock.enterTag')}
              className="w-full text-base bg-[var(--input)] text-[color:var(--foreground)] placeholder:text-[var(--muted-foreground)] border border-[color:var(--border)] rounded-lg px-3 py-2 mb-2.5 focus:ring-2 focus:ring-[color:var(--primary)]/30 focus:border-[color:var(--primary)] outline-none transition-shadow"
              maxLength={128}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  applyTag((e.target as HTMLInputElement).value);
                }
                if (e.key === 'Escape') {
                  setOpenTagEditor(null);
                  setTagEditorAnchor(null);
                }
              }}
            />
            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
              {getRecentLeadTags().map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className="text-base font-medium px-2.5 py-1 rounded-sm bg-[var(--secondary)] text-[var(--foreground)] hover:bg-[color:var(--primary)]/15 hover:text-[color:var(--primary)] border border-transparent hover:border-[color:var(--primary)]/30 transition-colors"
                  onClick={() => applyTag(tag)}
                >
                  #{tagLabel(tag)}
                </button>
              ))}
            </div>
            {currentSlotValue && (
              <button
                type="button"
                className="mt-2.5 w-full text-base text-[color-mix(in_srgb,var(--destructive)_88%,transparent)] hover:bg-[color-mix(in_srgb,var(--destructive)_12%,var(--card))] py-1.5 rounded-md transition-colors"
                onClick={() => applyTag('')}
              >{t('leadsBlock.deleteTag')}</button>
            )}
          </div>,
          document.body
        );
      })()}
      
      {/* Модалка с вертикальным слайдером для мобильных */}
      {selectedLeadForStageModal && (
        <MobileStageModal
          isOpen={isMobileStageModalOpen}
          onClose={() => {
            setIsMobileStageModalOpen(false);
            setSelectedLeadForStageModal(null);
          }}
          currentPosition={sliderPositions[selectedLeadForStageModal.id] || 1}
          statusLabels={statusLabels}
          statusGroups={statusGroups}
          onStageChange={(newPosition) => {
            updateSliderPosition(selectedLeadForStageModal.id, newPosition);
          }}
          leadName={selectedLeadForStageModal.name}
          isWorkStarted={
            backendLeads.find(l => l._id === selectedLeadForStageModal.id)?.stage === LeadStage.NETWORK_WORK_STARTED
          }
        />
      )}
    </div>
  );
};

export default LeadsBlock;
