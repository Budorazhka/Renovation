"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import { ArrowLeft, Filter, Search, X, Eye, MessageSquare, ListTodo, Upload } from "lucide-react"
import { LeadsImportDialog } from "@/components/leads/LeadsImportDialog"
import { useLeads } from "@/context/LeadsContext"
import { useAuth } from "@/context/AuthContext"
import { useRolePermissions } from "@/hooks/useRolePermissions"
import { LeadsSecretDistributionDialog } from "@/components/leads/LeadsSecretDistributionDialog"
import type { Lead } from "@/types/leads"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import LeadViewModal from "@/features/crm/components/crm/LeadViewModal"
import { LeadStage, ProductType, type Lead as CrmLead } from "@/features/crm/services/api/types"
import { leadsApiV2, OLD_BASE_TAG } from "@/services/leadsApiV2"
import { mapPokerIdToCrmStage, POKER_SOURCE_TO_CRM_PRODUCT } from "@/lib/crm-poker-adapter"
import { useNavigate, useSearchParams } from "react-router-dom"
import { cn } from "@/lib/utils"
import { PageOverlay } from "@/components/ui/Loading"
import { useI18n } from "@/i18n"
import "./leads-secret-table.css"

interface PokerStage {
  id: string
  name: string
  column: "rejection" | "in_progress" | "success"
}

const RP_STAGES: PokerStage[] = [
  { id: "defective", name: "Бракованный лид", column: "rejection" },
  { id: "refused", name: "Отказ", column: "rejection" },
  { id: "no_answer_3", name: "Недозвонился 3", column: "rejection" },
  { id: "no_answer_2", name: "Недозвонился 2", column: "rejection" },
  { id: "no_answer_1", name: "Недозвонился 1", column: "rejection" },

  { id: "new", name: "Новый лид", column: "in_progress" },
  { id: "callback", name: "Попросил связаться позже", column: "in_progress" },
  { id: "presented", name: "Презентовали компанию", column: "in_progress" },
  { id: "country_discussed", name: "Обсудили ситуацию в стране", column: "in_progress" },
  { id: "need_identified", name: "Выявлена потребность", column: "in_progress" },
  { id: "need_adjusted", name: "Потребность скорректирована", column: "in_progress" },
  { id: "kp_sent", name: "Отправлено КП", column: "in_progress" },
  { id: "objections", name: "Отработка возражений", column: "in_progress" },
  { id: "deferred", name: "Отложенный спрос", column: "in_progress" },
  { id: "warmup", name: "Прогрев", column: "in_progress" },
  { id: "showing", name: "Показ", column: "in_progress" },
  { id: "deposit", name: "Задаток получен", column: "in_progress" },
  { id: "deal", name: "Заключен договор", column: "in_progress" },

  { id: "golden", name: "Золотой фонд", column: "success" },
  { id: "check_in", name: "Узнал как дела", column: "success" },
  { id: "referral", name: "Взять рекомендацию", column: "success" },
  { id: "new_deals", name: "Выявление потребности о новых сделках", column: "success" },
]

const NET_STAGES: PokerStage[] = [
  { id: "defective", name: "Бракованный лид", column: "rejection" },
  { id: "refused", name: "Отказ", column: "rejection" },
  { id: "no_answer_3", name: "Недозвонился 3", column: "rejection" },
  { id: "no_answer_2", name: "Недозвонился 2", column: "rejection" },
  { id: "no_answer_1", name: "Недозвонился 1", column: "rejection" },

  { id: "new", name: "Новый лид", column: "in_progress" },
  { id: "callback", name: "Попросил связаться позже", column: "in_progress" },
  { id: "presented", name: "Презентовали компанию и стратегию", column: "in_progress" },
  { id: "country_discussed", name: "Презентовали платформу", column: "in_progress" },
  { id: "need_identified", name: "Вручили оффер", column: "in_progress" },
  { id: "need_adjusted", name: "Работа с возражениями", column: "in_progress" },
  { id: "kp_sent", name: "Отложенный спрос", column: "in_progress" },
  { id: "objections", name: "Согласие", column: "in_progress" },
  { id: "deferred", name: "Заполнена анкета", column: "in_progress" },
  { id: "warmup", name: "Регистрация в личном кабинете", column: "in_progress" },
  { id: "showing", name: "Подписание оферты", column: "in_progress" },
  { id: "deposit", name: "Начало работы", column: "in_progress" },
]

const OWNER_STAGES: PokerStage[] = [
  { id: "defective", name: "Бракованный контакт", column: "rejection" },
  { id: "refused", name: "Отказ собственника", column: "rejection" },
  { id: "no_answer_3", name: "Недозвонился 3", column: "rejection" },
  { id: "no_answer_2", name: "Недозвонился 2", column: "rejection" },
  { id: "no_answer_1", name: "Недозвонился 1", column: "rejection" },

  { id: "new", name: "Новый собственник", column: "in_progress" },
  { id: "callback", name: "Попросил связаться позже", column: "in_progress" },
  { id: "presented", name: "Презентовали компанию", column: "in_progress" },
  { id: "country_discussed", name: "Обсудили объект и условия", column: "in_progress" },
  { id: "need_identified", name: "Предложили фотосессия", column: "in_progress" },
  { id: "need_adjusted", name: "Предложен эксклюзив", column: "in_progress" },
  { id: "kp_sent", name: "Отработали возражения", column: "in_progress" },
  { id: "objections", name: "Договорились о сотрудничестве", column: "in_progress" },
  { id: "deferred", name: "Объект активен в продаже", column: "in_progress" },
  { id: "warmup", name: "Взять рекомендацию", column: "in_progress" },
  { id: "showing", name: "Узнать о новом объекте", column: "in_progress" },
]

const AGENT_STAGES: PokerStage[] = [
  { id: "defective", name: "Бракованный контакт", column: "rejection" },
  { id: "refused", name: "Отказ", column: "rejection" },
  { id: "no_answer_3", name: "Недозвонился 3", column: "rejection" },
  { id: "no_answer_2", name: "Недозвонился 2", column: "rejection" },
  { id: "no_answer_1", name: "Недозвонился 1", column: "rejection" },

  { id: "new", name: "Новый посредник", column: "in_progress" },
  { id: "callback", name: "Попросил связаться позже", column: "in_progress" },
  { id: "presented", name: "Презентовали компанию", column: "in_progress" },
  { id: "country_discussed", name: "Формат сотрудничества", column: "in_progress" },
  { id: "need_identified", name: "Работа с возражениями", column: "in_progress" },
  { id: "need_adjusted", name: "Согласие сотрудничать", column: "in_progress" },
  { id: "kp_sent", name: "Активный посредник", column: "in_progress" },
]

const REJECTION_STAGE_IDS = new Set([
  "defective",
  "refused",
  "no_answer_3",
  "no_answer_2",
  "no_answer_1",
])

function getLeadStageColumn(stageId: string): "rejection" | "in_progress" | "success" {
  if (REJECTION_STAGE_IDS.has(stageId)) {
    return "rejection"
  }
  if (["golden", "check_in", "referral", "new_deals"].includes(stageId)) {
    return "success"
  }
  return "in_progress"
}

/** Фиксированный размер покер-доски; масштабируется под доступную область, чтобы не было прокрутки. */
const POKER_BOARD_W = 1460
const POKER_BOARD_H = 780

function getLeadProblemState(lead: Lead): "neutral" | "critical" {
  if (REJECTION_STAGE_IDS.has(lead.stageId)) return "critical"
  if (!lead.managerId || lead.hasTask === false || lead.taskOverdue) return "critical"
  return "neutral"
}

function getDeckVisualState(stageId: string, leads: Lead[]): "neutral" | "critical" {
  if (REJECTION_STAGE_IDS.has(stageId)) return "critical"
  if (leads.length === 0) return "neutral"
  return leads.some((lead) => getLeadProblemState(lead) === "neutral") ? "neutral" : "critical"
}

function stageTopArcPosition(index: number, total: number): { x: number; y: number } {
  const ratio = total <= 1 ? 0 : index / (total - 1)
  const x = 5 + ratio * 90
  const arc = Math.sin(ratio * Math.PI)
  const y = 14 - arc * 14
  return { x, y }
}

function formatUsd(amount?: number | null): string {
  if (!amount || amount <= 0) return "—"
  return `$${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
}

function pokerLeadToCrmLead(lead: Lead, fallbackUserId?: string): CrmLead {
  const productType = POKER_SOURCE_TO_CRM_PRODUCT[lead.source] ?? ProductType.SALES
  const stage = mapPokerIdToCrmStage(lead.stageId, productType) ?? LeadStage.NEEDS_ANALYSIS
  const createdAt = lead.createdAt
  const updatedAt = lead.updatedAt ?? lead.createdAt

  return {
    _id: lead.id,
    name: lead.name ?? lead.id,
    phone: lead.phone ?? "",
    stage,
    productType,
    assignedTo: lead.managerId ?? "",
    createdBy: fallbackUserId ?? lead.managerId ?? "",
    history: [],
    dealValue: lead.commissionUsd ?? 0,
    budgetValue: lead.commissionUsd,
    createdAt,
    updatedAt,
  }
}

function visibleLeadCards(leads: Lead[], cursor: number): Lead[] {
  if (leads.length === 0) return []
  const index = cursor % leads.length
  return [leads[index]]
}

/** Карточка лида для DragOverlay (тот же вид, что в StageDeckPile) */
function DraggedCardOverlay({ lead, compact = false }: { lead: Lead; compact?: boolean }) {
  const cardWidth = compact ? 76 : 95
  const cardHeight = compact ? 114 : 142
  const isCritical = getLeadProblemState(lead) === "critical"
  const columnId = getLeadStageColumn(lead.stageId)

  return (
    <div
      className={cn(
        "v2-card-face overflow-hidden px-1.5 py-1.5 text-center shadow-[0_8px_24px_rgba(0,0,0,0.4)]",
        compact ? "rounded-[11px]" : "rounded-[14px]",
        isCritical && "is-critical"
      )}
      style={{ width: cardWidth, height: cardHeight }}
    >
      <p
        className={cn(
          "relative z-10 font-medium leading-tight text-black",
          compact ? "mt-2 text-[11px]" : "mt-4 text-[13px]",
          "line-clamp-3 whitespace-normal break-words"
        )}
      >
        {lead.name ?? lead.id}
      </p>
      {columnId === "in_progress" && lead.commissionUsd != null && (
        <p className={cn("relative z-10 font-medium text-black", compact ? "mt-0.5 text-[9px]" : "mt-1 text-[10px]")}>
          {formatUsd(lead.commissionUsd)}
        </p>
      )}
    </div>
  )
}

export type LeadsCardTableViewVariant = "dialog" | "page"
type LeadViewInitialTab = "tasks" | "objects" | "info" | "history"
type PokerProduct = "RP" | "Net" | "Owner" | "Agent"

export function LeadsCardTableView({
  variant,
  selectedManagerId,
  onSelectedManagerIdChange,
  onClose,
  onBack,
  viewMode,
  viewSwitcher,
}: {
  variant: LeadsCardTableViewVariant
  selectedManagerId: string
  onSelectedManagerIdChange: (id: string) => void
  onClose?: () => void
  /** В режиме page — опциональная кнопка «Назад» */
  onBack?: () => void
  viewMode: "poker" | "list"
  /** Переключатель вида CRM (стол / список / классический) — владеет им страница. */
  viewSwitcher: ReactNode
}) {
  const { state, dispatch, isLoading, refreshLeads } = useLeads()
  const { currentUser } = useAuth()
  const { t } = useI18n()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { isRopOrAbove } = useRolePermissions()
  const isManager = currentUser?.role === "manager"
  const [distributionOpen, setDistributionOpen] = useState(false)
  // Кнопка видна РОПу+ или менеджеру назначенному дежурным в ручном режиме
  const canOpenDistribution = isRopOrAbove || (isManager && state.manualDistributorId === currentUser?.id)
  const { leadPool, leadManagers } = state
  const [cursorByStageId, setCursorByStageId] = useState<Record<string, number>>({})
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)
  const [selectedProduct, setSelectedProduct] = useState<PokerProduct>(() => {
    const p = searchParams.get("product")
    if (p === "Net" || p === "Owner" || p === "Agent") return p
    return "RP"
  })

  const currentStages = useMemo(() => {
    switch (selectedProduct) {
      case "Net": return NET_STAGES
      case "Owner": return OWNER_STAGES
      case "Agent": return AGENT_STAGES
      default: return RP_STAGES
    }
  }, [selectedProduct])

  const inProgressStages = useMemo(() => currentStages.filter((s) => s.column === "in_progress"), [currentStages])
  const rejectionStages = useMemo(() => currentStages.filter((s) => s.column === "rejection").slice().reverse(), [currentStages])
  const successStages = useMemo(() => currentStages.filter((s) => s.column === "success").slice().reverse(), [currentStages])

  const handleProductChange = (prod: PokerProduct) => {
    setSelectedProduct(prod)
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev)
      p.set("product", prod)
      return p
    })
  }
  const [q, setQ] = useState("")
  const [filterNoTask, setFilterNoTask] = useState(false)
  const [filterNoManager, setFilterNoManager] = useState(false)
  const [filterOldBase, setFilterOldBase] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [filterOverdue, setFilterOverdue] = useState(false)

  // Force selectedManagerId for manager role
  useEffect(() => {
    if (isManager && currentUser?.id && selectedManagerId !== currentUser.id) {
      onSelectedManagerIdChange(currentUser.id)
    }
  }, [isManager, currentUser?.id, selectedManagerId, onSelectedManagerIdChange])
  const [onlyCritical, setOnlyCritical] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [dateFrom, setDateFrom] = useState<string>("")
  const [dateTo, setDateTo] = useState<string>("")
  const [historyOpen, setHistoryOpen] = useState(false)
  const [leadViewInitialTab, setLeadViewInitialTab] = useState<LeadViewInitialTab>("history")
  const [leadDetailsUnavailable, setLeadDetailsUnavailable] = useState(false)

  /**
   * LeadViewModal переведён на новый backend (apps/api, /leads/*, см. план
   * фазы 3) — id лида на этом экране это id из НОВОГО backend, поэтому
   * пробный getById здесь проверяет то же самое, что откроет модалка, не
   * легаси-совместимость. 404 теперь означает "лид реально не существует"
   * (удалён/чужая организация), а не "ещё не мигрировал" — честная ошибка,
   * не переходный пробел.
   */
  const openLeadDetails = async (leadId: string, tab: LeadViewInitialTab) => {
    setSelectedLeadId(leadId)
    setLeadViewInitialTab(tab)
    try {
      await leadsApiV2.getById(leadId)
      setHistoryOpen(true)
      return
    } catch {
      // лид не найден на новом backend — см. докстринг выше
    }
    setLeadDetailsUnavailable(true)
  }
  const [transferConfirm, setTransferConfirm] = useState<{ newManagerId: string | null; newManagerName: string } | null>(null)
  const [dealSession, setDealSession] = useState(0)
  const [draggingLead, setDraggingLead] = useState<Lead | null>(null)
  const [expandedStageId, setExpandedStageId] = useState<string | null>(null)

  // Покер-доска фиксированного размера масштабируется под доступную область — без прокрутки и наездов.
  const fitRef = useRef<HTMLDivElement>(null)
  const [fitScale, setFitScale] = useState(1)
  useEffect(() => {
    if (viewMode !== "poker") return
    const el = fitRef.current
    if (!el) return
    const update = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      if (w && h) setFitScale(Math.min(w / POKER_BOARD_W, h / POKER_BOARD_H, 1))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [viewMode])

  const enableDnD = variant === "page"

  useEffect(() => {
    if (variant === "dialog") {
      setDealSession((s) => s + 1)
    }
  }, [variant])

  const focusLeadIdFromUrl = searchParams.get("lead")

  /** Переход из карточки сделки: полная карточка лида (?lead=…) */
  useEffect(() => {
    if (variant !== "page" || !focusLeadIdFromUrl) return
    const lead = leadPool.find((l) => l.id === focusLeadIdFromUrl)
    if (!lead) {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev)
          p.delete("lead")
          return p
        },
        { replace: true },
      )
      return
    }
    onSelectedManagerIdChange("_all")
    setSelectedLeadId(focusLeadIdFromUrl)
    const peers = leadPool.filter((l) => l.stageId === lead.stageId)
    const idx = peers.findIndex((l) => l.id === focusLeadIdFromUrl)
    if (idx >= 0) {
      setCursorByStageId((prev) => ({ ...prev, [lead.stageId]: idx }))
    }
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        p.delete("lead")
        return p
      },
      { replace: true },
    )
  }, [variant, focusLeadIdFromUrl, leadPool, setSearchParams, onSelectedManagerIdChange])

  /** Диплинк с рабочего стола: «распределение лидов» → фильтр «Без менеджера» в покере */
  const distributionFromUrl = searchParams.get("distribution")
  useEffect(() => {
    if (variant !== "page" || distributionFromUrl !== "1") return
    if (!isManager) onSelectedManagerIdChange("_all")
    setFilterNoManager(true)
    setFilterNoTask(false)
    setFilterOverdue(false)
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        p.delete("distribution")
        return p
      },
      { replace: true },
    )
  }, [variant, distributionFromUrl, isManager, setSearchParams, onSelectedManagerIdChange])

  /** Диплинк: «лиды с нарушением» / SLA — включает фильтр просрочки по задаче в покере */
  const violationsFromUrl = searchParams.get("violations")
  useEffect(() => {
    if (variant !== "page" || violationsFromUrl !== "1") return
    setFilterNoTask(false)
    setFilterNoManager(false)
    setFilterOverdue(true)
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        p.delete("violations")
        return p
      },
      { replace: true },
    )
  }, [variant, violationsFromUrl, setSearchParams])

  const managerNameById = useMemo(() => {
    const map: Record<string, string> = {}
    leadManagers.forEach((manager) => {
      map[manager.id] = manager.name
    })
    return map
  }, [leadManagers])

  const filteredLeads = useMemo(() => {
    let list = leadPool
    
    const pokerSource =
      selectedProduct === "RP" ? "primary" :
      selectedProduct === "Net" ? "secondary" :
      selectedProduct === "Owner" ? "rent" :
      "ad_campaigns"
    list = list.filter((lead) => lead.source === pokerSource)

    if (selectedManagerId === "_unassigned") list = list.filter((lead) => !lead.managerId)
    else if (selectedManagerId !== "_all") list = list.filter((lead) => lead.managerId === selectedManagerId)

    const term = q.trim().toLowerCase()
    if (term) {
      list = list.filter((lead) => (lead.name ?? lead.id).toLowerCase().includes(term))
    }

    if (filterOldBase) {
      list = list.filter((lead) => lead.tags?.includes(OLD_BASE_TAG))
    }

    if (filterNoTask || filterNoManager || filterOverdue) {
      list = list.filter((lead) => {
        const noTask = lead.hasTask === false
        const noManager = !lead.managerId
        const overdue = lead.taskOverdue === true
        const conditions: boolean[] = []
        if (filterNoTask) conditions.push(noTask)
        if (filterNoManager) conditions.push(noManager)
        if (filterOverdue) conditions.push(overdue)
        return conditions.some(Boolean)
      })
    }

    if (onlyCritical) {
      list = list.filter((lead) => getLeadProblemState(lead) === "critical")
    }

    if (dateFrom || dateTo) {
      const fromDate = dateFrom ? new Date(dateFrom) : null
      const toDate = dateTo ? new Date(dateTo) : null
      if (toDate) toDate.setHours(23, 59, 59, 999)
      list = list.filter((lead) => {
        const created = new Date(lead.createdAt)
        if (Number.isNaN(created.getTime())) return true
        if (fromDate && created < fromDate) return false
        if (toDate && created > toDate) return false
        return true
      })
    }

    return list
  }, [leadPool, selectedManagerId, q, filterNoTask, filterNoManager, filterOverdue, filterOldBase, onlyCritical, dateFrom, dateTo, selectedProduct])

  const leadsByStage = useMemo(() => {
    const map: Record<string, Lead[]> = {}
    currentStages.forEach((stage) => {
      map[stage.id] = []
    })
    filteredLeads.forEach((lead) => {
      if (map[lead.stageId]) map[lead.stageId].push(lead)
    })
    return map
  }, [filteredLeads, currentStages])

  const totals = useMemo(() => {
    const critical = filteredLeads.filter((lead) => getLeadProblemState(lead) === "critical").length
    const totalCommission = filteredLeads.reduce((sum, lead) => sum + (lead.commissionUsd ?? 0), 0)
    const criticalCommission = filteredLeads.reduce(
      (sum, lead) =>
        sum + (getLeadProblemState(lead) === "critical" ? (lead.commissionUsd ?? 0) : 0),
      0
    )
    return {
      total: filteredLeads.length,
      critical,
      totalCommission,
      criticalCommission,
    }
  }, [filteredLeads])


  const dealOrderByLeadId = useMemo(() => {
    const order: Record<string, number> = {}
    let idx = 0
    const addStages = (stages: typeof inProgressStages) => {
      stages.forEach((stage) => {
        const leads = leadsByStage[stage.id] ?? []
        const cursor = cursorByStageId[stage.id] ?? 0
        const [front] = visibleLeadCards(leads, cursor)
        if (front) order[front.id] = idx++
      })
    }
    addStages(inProgressStages)
    addStages(rejectionStages)
    addStages(successStages)
    return order
  }, [leadsByStage, cursorByStageId, inProgressStages, rejectionStages, successStages])

  const fallbackLead = filteredLeads[0] ?? null
  const activeLead =
    selectedLeadId
      ? filteredLeads.find((lead) => lead.id === selectedLeadId) ?? fallbackLead
      : fallbackLead
  const activeStage = activeLead
    ? currentStages.find((stage) => stage.id === activeLead.stageId) ?? null
    : null
  const activityDate = activeLead
    ? new Date(activeLead.updatedAt ?? activeLead.createdAt)
    : null
  const activityLabel = activityDate
    ? `${activityDate.toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}, ${activityDate.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`
    : "—"
  const createdLabel = activeLead
    ? new Date(activeLead.createdAt).toLocaleDateString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : "—"
  const activeLeadCommission = activeLead?.commissionUsd ?? null
  const activeCrmLead = activeLead ? pokerLeadToCrmLead(activeLead, currentUser?.id) : null
  const productLabel = (prod: PokerProduct) => t(`crmPoker.product.${prod}`)
  const stageLabel = (stage: PokerStage) => t(`crmPoker.stages.${selectedProduct}.${stage.id}`, stage.name)
  const formatMessage = (template: string, values: Record<string, string>) =>
    Object.entries(values).reduce((message, [key, value]) => message.replace(`{${key}}`, value), template)

  const stepStage = (stageId: string, leads: Lead[], direction: 1 | -1) => {
    if (leads.length === 0) return
    setCursorByStageId((current) => {
      const safeCurrent = (current[stageId] ?? 0) % leads.length
      const next =
        direction === 1
          ? (safeCurrent + 1) % leads.length
          : (safeCurrent - 1 + leads.length) % leads.length
      setSelectedLeadId(leads[next]?.id ?? leads[0]?.id ?? null)
      return { ...current, [stageId]: next }
    })
  }

  const handleMoveLead = (leadId: string, newStageId: string) => {
    dispatch({ type: "UPDATE_LEAD_STAGE", leadId, stageId: newStageId })
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  const handleDragStart = (event: DragStartEvent) => {
    const lead = filteredLeads.find((l) => l.id === event.active.id)
    if (lead) setDraggingLead(lead)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setDraggingLead(null)
    const { active, over } = event
    if (!over || active.id === over.id) return
    const leadId = String(active.id)
    const toStageId = String(over.id)
    const lead = filteredLeads.find((l) => l.id === leadId)
    if (!lead || lead.stageId === toStageId) return
    handleMoveLead(leadId, toStageId)
  }

  const tableContent = (
    <div className="v2-table-root flex h-full min-h-0 flex-col">
      <div className="v2-table-bg" aria-hidden />
      <div className="v2-table-ornament" aria-hidden />

      <header className="v2-table-hud !flex-row !flex-nowrap !gap-2 !text-left sm:!text-left">
        {isManager ? (
          <div className="h-7 w-[150px] shrink-0 border border-[var(--hub-card-border)] bg-[var(--input)] px-2 text-[11px] text-[var(--app-text)] flex items-center rounded-md opacity-80 cursor-default">
            {currentUser?.name}
          </div>
        ) : (
          <Select value={selectedManagerId} onValueChange={onSelectedManagerIdChange}>
            <SelectTrigger className="h-7 w-[150px] shrink-0 border-[var(--hub-card-border)] bg-[var(--input)] px-2 text-[11px] text-[var(--app-text)] focus:ring-[var(--gold)]/30">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-[var(--hub-card-border)] bg-[var(--green-card)] text-[var(--app-text)]">
              <SelectItem value="_all" className="text-[var(--app-text)] focus:bg-[var(--dropdown-hover)] focus:text-[var(--app-text)]">{t('crmPoker.allNetwork')}</SelectItem>
              {leadManagers.map((manager) => (
                <SelectItem key={manager.id} value={manager.id} className="text-[var(--app-text)] focus:bg-[var(--dropdown-hover)] focus:text-[var(--app-text)]">
                  {manager.name}
                </SelectItem>
              ))}
              <SelectItem value="_unassigned" className="text-[var(--app-text)] focus:bg-[var(--dropdown-hover)] focus:text-[var(--app-text)]">{t('crmPoker.unassigned')}</SelectItem>
            </SelectContent>
          </Select>
        )}

        <div className="h-4 w-px bg-[color-mix(in_srgb,var(--gold)_22%,transparent)] mx-1 self-center shrink-0" />

        <div className="flex items-center gap-4 text-[11px] font-medium text-[var(--app-text)] shrink-0 select-none">
          <div className="flex items-center gap-3">
            {(['RP', 'Net', 'Owner', 'Agent'] as const).map((prod) => {
              return (
                <label key={prod} className="flex items-center gap-1 cursor-pointer select-none">
                  <input
                    type="radio"
                    name="poker-product"
                    value={prod}
                    checked={selectedProduct === prod}
                    onChange={() => handleProductChange(prod)}
                    className="accent-[var(--gold)] size-3 cursor-pointer"
                  />
                  <span className={cn(
                    "text-[11px] transition-colors",
                    selectedProduct === prod ? "text-[var(--gold)] font-medium" : "text-[var(--app-text-muted)] hover:text-[var(--app-text)]"
                  )}>
                    {productLabel(prod)}
                  </span>
                </label>
              )
            })}
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "h-7 shrink-0 gap-1 border-[var(--hub-card-border)] bg-[var(--green-card)] px-1.5 text-[11px] hover:bg-[var(--green-card-hover)]",
                (dateFrom || dateTo || onlyCritical || filterNoTask || filterNoManager || filterOverdue || filterOldBase)
                  ? "text-[var(--gold)] border-[color-mix(in_srgb,var(--gold)_44%,transparent)]"
                  : "text-[var(--app-text-muted)]"
              )}
            >
              <Filter className="size-3" />
              {t('crmPoker.filters')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side="top"
            sideOffset={6}
            className="min-w-[190px] border-[var(--hub-card-border)] bg-[var(--green-card)] text-[var(--app-text)] z-[100]"
          >
            <DropdownMenuLabel className="text-xs uppercase tracking-wide text-[var(--app-text-muted)]">
              {t('crmPoker.show')}
            </DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              checked={onlyCritical}
              onCheckedChange={(v) => setOnlyCritical(v === true)}
              className="text-sm focus:bg-[var(--dropdown-hover)] focus:text-[var(--app-text)]"
            >
              {t('crmPoker.onlyProblem')}
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator className="border-[var(--hub-card-border)]" />
            <DropdownMenuCheckboxItem
              checked={filterNoTask}
              onCheckedChange={(v) => setFilterNoTask(v === true)}
              className="text-sm focus:bg-[var(--dropdown-hover)] focus:text-[var(--app-text)]"
            >
              {t('crmPoker.noTasks')}
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={filterNoManager}
              onCheckedChange={(v) => setFilterNoManager(v === true)}
              className="text-sm focus:bg-[var(--dropdown-hover)] focus:text-[var(--app-text)]"
            >
              {t('crmPoker.noManager')}
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={filterOverdue}
              onCheckedChange={(v) => setFilterOverdue(v === true)}
              className="text-sm focus:bg-[var(--dropdown-hover)] focus:text-[var(--app-text)]"
            >
              {t('crmPoker.taskOverdue')}
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={filterOldBase}
              onCheckedChange={(v) => setFilterOldBase(v === true)}
              className="text-sm focus:bg-[var(--dropdown-hover)] focus:text-[var(--app-text)]"
            >
              {t('crmPoker.oldBaseFilter')}
            </DropdownMenuCheckboxItem>
            {!isManager && (
              <>
                <DropdownMenuSeparator className="border-[var(--hub-card-border)]" />
                <DropdownMenuCheckboxItem
                  checked={showStats}
                  onCheckedChange={(v) => setShowStats(v === true)}
                  className="text-sm focus:bg-[var(--dropdown-hover)] focus:text-[var(--app-text)]"
                >
                  {t('crmPoker.showTotalStats')}
                </DropdownMenuCheckboxItem>
              </>
            )}

            <DropdownMenuSeparator className="border-[var(--hub-card-border)]" />
            <div className="px-2 py-2 flex flex-col gap-1.5">
              <label className="text-[10px] uppercase tracking-wide text-[var(--app-text-muted)]">{t('crmPoker.date')}</label>
              <div className="flex items-center gap-1">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="h-6 w-full rounded border border-[var(--hub-card-border)] bg-[var(--input)] px-1.5 text-[11px] text-[var(--app-text)] [color-scheme:dark]"
                />
                <span className="text-[9px] text-[var(--app-text-muted)]">—</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="h-6 w-full rounded border border-[var(--hub-card-border)] bg-[var(--input)] px-1.5 text-[11px] text-[var(--app-text)] [color-scheme:dark]"
                />
              </div>
              {(dateFrom || dateTo) && (
                <button
                  className="mt-0.5 text-[10px] text-rose-500 hover:text-rose-400 text-left"
                  onClick={() => { setDateFrom(""); setDateTo("") }}
                >
                  {t('crmPoker.resetDate')}
                </button>
              )}
            </div>
            
            {(filterNoTask || filterNoManager || filterOverdue) && (
              <>
                <DropdownMenuSeparator className="border-[var(--hub-card-border)]" />
                <div 
                  className="px-2 py-1.5 text-xs text-rose-500 font-medium cursor-pointer hover:bg-rose-50 hover:text-rose-600 transition-colors text-center"
                  onClick={() => {
                    setFilterNoTask(false)
                    setFilterNoManager(false)
                    setFilterOverdue(false)
                  }}
                >
                  {t('crmPoker.resetFilters')}
                </div>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="relative min-w-0 w-[200px] flex gap-3 items-center">
          <div className="relative w-full">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-[var(--app-text-subtle)]" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('crmPoker.searchByName')}
              className="h-7 w-full border-[var(--hub-card-border)] bg-[var(--input)] pl-7 text-[11px] text-[var(--app-text)] placeholder:text-[var(--app-text-subtle)]"
            />
          </div>
        </div>

        {canOpenDistribution && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDistributionOpen(true)}
            className="h-7 shrink-0 gap-1.5 px-2.5 text-[11px] font-medium border-[var(--hub-card-border)] bg-[var(--green-card)] text-[var(--app-text)] hover:border-[var(--hub-card-border-hover)] hover:bg-[var(--green-card-hover)]"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="size-3.5 shrink-0">
              <rect x="3" y="1" width="15" height="21" rx="2.2" />
              <rect x="7" y="3" width="15" height="21" rx="2.2" />
              <path d="M19.5 8.5l1.5 2.5-1.5 2.5-1.5-2.5 1.5-2.5z" fill="currentColor" stroke="none" />
            </svg>
            {t('crmPoker.distribution')}
          </Button>
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={() => setImportOpen(true)}
          className="h-7 shrink-0 gap-1.5 px-2.5 text-[11px] font-medium border-[var(--hub-card-border)] bg-[var(--green-card)] text-[var(--app-text)] hover:border-[var(--hub-card-border-hover)] hover:bg-[var(--green-card-hover)]"
        >
          <Upload className="size-3.5 shrink-0" />
          {t('crmPoker.importBase')}
        </Button>

        {viewSwitcher}

        {variant === "dialog" && onClose && (
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            className="v2-close-btn ml-auto h-7 shrink-0 gap-1 px-2 text-[11px] font-medium"
          >
            <X className="size-3" />
            {t('common.close')}
          </Button>
        )}
        {variant === "page" && onBack && (
          <Button
            variant="outline"
            size="sm"
            onClick={onBack}
            className="ml-auto h-7 shrink-0 gap-1 px-2 text-[11px] font-medium border-[var(--hub-card-border)] bg-[var(--green-card)] text-[var(--app-text-muted)] hover:bg-[var(--green-card-hover)]"
          >
            <ArrowLeft className="size-3" />
            {t('common.back')}
          </Button>
        )}
      </header>

      <LeadsSecretDistributionDialog open={distributionOpen} onOpenChange={setDistributionOpen} />
      <LeadsImportDialog open={importOpen} onOpenChange={setImportOpen} onImported={() => void refreshLeads()} />

      {viewMode === "list" && (
        <div className="relative z-10 min-h-0 flex-1 overflow-auto p-6" style={{ fontFamily: "Montserrat, sans-serif" }}>
          <div className="rounded-xl border border-[var(--hub-card-border)] bg-[var(--green-card)] shadow-[0_4px_24px_rgba(0,0,0,0.1)] overflow-hidden">
            {filteredLeads.length === 0 ? (
              <div className="py-16 text-center text-[12px] font-medium text-[var(--app-text-subtle)]">
                {t('crmPoker.emptyFiltered')}
              </div>
            ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse">
                <thead>
                  <tr className="border-b border-[var(--hub-card-border)] bg-[var(--green-card-hover)]">
                    <th className="text-left text-[10px] font-normal uppercase tracking-widest text-[var(--app-text-muted)] px-4 py-3">{t('crmPoker.stage')}</th>
                    <th className="text-left text-[10px] font-normal uppercase tracking-widest text-[var(--app-text-muted)] px-4 py-3">{t('crmPoker.lead')}</th>
                    <th className="text-left text-[10px] font-normal uppercase tracking-widest text-[var(--app-text-muted)] px-4 py-3">{t('crmPoker.manager')}</th>
                    <th className="text-left text-[10px] font-normal uppercase tracking-widest text-[var(--app-text-muted)] px-4 py-3">{t('crmPoker.commission')}</th>
                    <th className="text-center text-[10px] font-normal uppercase tracking-widest text-[var(--app-text-muted)] px-4 py-3 w-20">{t('crmPoker.task')}</th>
                    <th className="text-center text-[10px] font-normal uppercase tracking-widest text-[var(--app-text-muted)] px-4 py-3 w-20">{t('crmPoker.overdueShort')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgba(243,209,139,0.08)]">
                  {filteredLeads
                    .slice()
                    .sort((a, b) => {
                      const stageOrderA = currentStages.findIndex((s) => s.id === a.stageId)
                      const stageOrderB = currentStages.findIndex((s) => s.id === b.stageId)
                      if (stageOrderA !== stageOrderB) return stageOrderA - stageOrderB
                      return (a.name ?? a.id).localeCompare(b.name ?? b.id)
                    })
                    .map((lead) => {
                      const isActive = activeLead?.id === lead.id
                      const stage = currentStages.find((s) => s.id === lead.stageId)
                      const col = stage ? getLeadStageColumn(stage.id) : null
                      return (
                        <tr
                          key={lead.id}
                          onClick={() => void openLeadDetails(lead.id, "history")}
                          className={cn(
                            "cursor-pointer transition-colors",
                            isActive
                              ? "bg-[color-mix(in_srgb,var(--gold)_12%,var(--green-card))] border-l-2 border-l-[var(--gold)]"
                              : "hover:bg-[var(--green-card-hover)]"
                          )}
                        >
                          <td className="px-4 py-2.5">
                            <span className={cn(
                              "text-[11px] font-normal",
                              col === "rejection" ? "text-rose-500" : col === "success" ? "text-emerald-500" : "text-[var(--app-text-muted)]"
                            )}>
                              {stage ? stageLabel(stage) : "—"}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={cn(
                              "text-[12px] font-normal text-[var(--app-text)]"
                            )}>
                              {lead.name ?? lead.id}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-[11px] text-[var(--app-text-muted)]">
                            {lead.managerId ? (managerNameById[lead.managerId] ?? "—") : t('crmPoker.unassigned')}
                          </td>
                          <td className="px-4 py-2.5">
                            {lead.commissionUsd != null && lead.commissionUsd > 0 ? (
                              <span className="text-[11px] font-normal text-[var(--gold)]">{formatUsd(lead.commissionUsd)}</span>
                            ) : (
                              <span className="text-[11px] text-[var(--app-text-subtle)]">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <span className={cn(
                              "text-[10px] font-normal uppercase",
                              lead.hasTask !== false ? "text-emerald-500" : "text-rose-400"
                            )}>
                              {lead.hasTask !== false ? t('crmPoker.yes') : t('crmPoker.no')}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <span className={cn(
                              "text-[10px] font-normal uppercase",
                              lead.taskOverdue ? "text-rose-400" : "text-[var(--app-text-subtle)]"
                            )}>
                              {lead.taskOverdue ? t('crmPoker.yes') : "—"}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </div>
            )}
          </div>
        </div>
      )}

      {viewMode === "poker" && (
      <div ref={fitRef} className="relative z-10 min-h-0 flex-1 overflow-hidden flex items-start justify-center">
        <div style={{ width: POKER_BOARD_W * fitScale, height: POKER_BOARD_H * fitScale, flex: "0 0 auto" }}>
          <div
            className="relative"
            style={{
              width: POKER_BOARD_W,
              height: POKER_BOARD_H,
              transform: `scale(${fitScale})`,
              transformOrigin: "top left",
              fontFamily: "Montserrat, sans-serif",
            }}
          >
          <div className="absolute left-8 right-8 top-0 h-[405px]">
            {inProgressStages.map((stage, index) => {
              const leads = leadsByStage[stage.id] ?? []
              const baseCursor = cursorByStageId[stage.id] ?? 0
              const safeCursor = leads.length > 0 ? baseCursor % leads.length : 0
              const pos = stageTopArcPosition(index, inProgressStages.length)
              return (
                <div
                  key={stage.id}
                  className="absolute w-[104px]"
                  style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: "translate(-50%, 0)" }}
                >
                  <StageDeckPile
                    stageId={stage.id}
                    stageLabel={stageLabel(stage)}
                    stageName={undefined}
                    leads={leads}
                    cursor={safeCursor}
                    onStep={stepStage}
                    onSelect={setSelectedLeadId}
                    activeLeadId={activeLead?.id ?? null}
                    selectedLeadId={selectedLeadId}
                    showStats={showStats}
                    dealOrderByLeadId={dealOrderByLeadId}
                    dealSession={dealSession}
                    enableDnD={enableDnD}
                    onMoveLead={enableDnD ? handleMoveLead : undefined}
                    onExpand={setExpandedStageId}
                    isExpanded={expandedStageId === stage.id}
                  />
                </div>
              )
            })}
          </div>

          {/* Стол без желтого круга */}

          <div className={cn(
            "absolute left-1/2 top-[53%] -translate-x-1/2 -translate-y-1/2 flex items-center justify-center z-10 w-full max-w-[400px]",
            expandedStageId && "opacity-0 pointer-events-none"
          )}>
            {!showStats ? (
              <div
                className="w-full flex flex-col justify-center text-[var(--app-text)]"
                style={{ fontFamily: "Montserrat, sans-serif" }}
              >
                <div className="flex w-full items-center justify-between gap-3 mb-1.5">
                  <p className="text-[12px] font-normal uppercase tracking-widest text-[var(--app-text-muted)]">
                    {t('crmPoker.deal')}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => activeLead && void openLeadDetails(activeLead.id, "history")}
                    className="h-6 px-3 text-[10px] font-normal tracking-wide rounded-full border border-[var(--hub-card-border)] bg-[var(--green-card)] text-[var(--app-text)] hover:bg-[var(--green-card-hover)] hover:text-[var(--app-text)] shadow-none"
                  >
                    {t('crmPoker.history')}
                  </Button>
                </div>
                <p className="mb-2 text-[10px] font-medium text-[var(--app-text-muted)] w-full text-left">
                  {t('crmPoker.from')}: {createdLabel}
                </p>
                <div className="w-full flex flex-col items-center mb-2">
                  <p className="line-clamp-2 text-center text-[20px] font-normal leading-tight text-[var(--app-text)] mb-0.5">
                    {activeLead?.name ?? "—"}
                  </p>
                  <p className="line-clamp-1 text-center text-[13px] font-normal text-[var(--app-text-muted)]">
                    {activeStage ? stageLabel(activeStage) : t('crmPoker.noStage')}
                  </p>
                </div>
                {/* Action buttons */}
                {activeLead && (
                  <div className="w-full flex items-center justify-center gap-3 mb-2">
                    <button
                      type="button"
                      onClick={() => {
                        const digits = (activeLead.phone ?? "").replace(/\D/g, "")
                        navigate(digits ? `/dashboard/chats?phone=${digits}` : "/dashboard/chats")
                      }}
                      className="flex flex-col items-center gap-1 px-4 py-1.5 rounded-xl border border-[var(--hub-card-border)] bg-[var(--green-card)] text-[var(--app-text-muted)] hover:bg-[var(--green-card-hover)] hover:border-[var(--hub-card-border-hover)] transition-colors"
                    >
                      <MessageSquare className="size-4" />
                      <span className="text-[8px] uppercase tracking-widest font-normal">{t('crmPoker.contact')}</span>
                    </button>
                    <button
                      onClick={() => activeLead && void openLeadDetails(activeLead.id, "tasks")}
                      className="flex flex-col items-center gap-1 px-4 py-1.5 rounded-xl border border-[rgba(243,209,139,0.3)] bg-[rgba(18,45,36,0.7)] text-[rgba(243,225,188,0.85)] hover:bg-[rgba(18,65,46,0.9)] hover:border-[rgba(243,225,188,0.5)] transition-colors"
                    >
                      <ListTodo className="size-4" />
                      <span className="text-[8px] uppercase tracking-widest font-normal">{t('crmPoker.task')}</span>
                    </button>
                  </div>
                )}

                <div className="w-full flex items-center justify-between border-t border-[var(--hub-card-border)] pt-2.5">
                  <div className="text-left pl-4">
                    <p className="text-[9px] font-normal uppercase tracking-widest text-[var(--app-text-muted)] mb-0.5">{t('crmPoker.progress')}</p>
                    <p className="text-[13px] font-normal leading-none text-[var(--app-text-muted)]">{activityLabel}</p>
                  </div>
                  <div className="text-right pr-4">
                    <p className="text-[9px] font-normal uppercase tracking-widest text-[var(--app-text-muted)] mb-0.5">{t('crmPoker.commission')}</p>
                    <p className="text-[16px] font-normal leading-none text-[var(--gold)]">{formatUsd(activeLeadCommission)}</p>
                  </div>
                </div>
              </div>
            ) : (
              <div
                className="grid grid-cols-2 gap-x-8 gap-y-3 rounded-[12px] border border-[var(--hub-card-border)] bg-[var(--green-card)] px-6 py-4 text-[var(--app-text)] shadow-[0_8px_24px_rgba(0,0,0,0.1)]"
                style={{ fontFamily: "Montserrat, sans-serif" }}
              >
                <p className="col-span-2 mb-1 text-center text-[10px] font-normal uppercase tracking-widest text-[var(--app-text-muted)]">{t('crmPoker.allStagesCount')}</p>
                <div className="text-center">
                  <p className="mb-0.5 text-[11px] uppercase tracking-widest text-[var(--app-text-muted)]">{t('crmPoker.totalLeads')}</p>
                  <p className="text-[24px] font-normal leading-none text-[var(--app-text)]">{totals.total}</p>
                </div>
                <div className="text-center">
                  <p className="mb-0.5 text-[11px] uppercase tracking-widest text-rose-500/80">{t('crmPoker.problemLeads')}</p>
                  <p className="text-[24px] font-normal leading-none text-rose-500">{totals.critical}</p>
                </div>
                <div className="text-center">
                  <p className="mb-0.5 text-[11px] uppercase tracking-widest text-[var(--app-text-muted)]">{t('crmPoker.problemShare')}</p>
                  <p className="text-[24px] font-normal leading-none text-[var(--app-text)]">
                    {totals.total > 0 ? Math.round((totals.critical / totals.total) * 100) : 0}%
                  </p>
                </div>
                <div className="text-center">
                  <p className="mb-0.5 text-[11px] uppercase tracking-widest text-[var(--app-text-muted)]">{t('crmPoker.commission')}</p>
                  <p className="text-[24px] font-normal leading-none text-emerald-500">{formatUsd(totals.totalCommission)}</p>
                </div>
                <div className="col-span-2 pt-1 text-center border-t border-[var(--hub-card-border)] mt-1">
                  <p className="mb-0.5 text-[11px] uppercase tracking-widest text-rose-500/80">{t('crmPoker.problemCommission')}</p>
                  <p className="text-[20px] font-normal leading-none text-rose-500">{formatUsd(totals.criticalCommission)}</p>
                </div>
              </div>
            )}
          </div>

          <div className="absolute bottom-10 left-10 flex items-end gap-5">
            {rejectionStages.map((stage) => {
              const leads = leadsByStage[stage.id] ?? []
              const baseCursor = cursorByStageId[stage.id] ?? 0
              const safeCursor = leads.length > 0 ? baseCursor % leads.length : 0
              return (
                <div key={stage.id} className="w-[104px]">
                  <StageDeckPile
                    stageId={stage.id}
                    stageLabel={stageLabel(stage)}
                    leads={leads}
                    cursor={safeCursor}
                    onStep={stepStage}
                    onSelect={setSelectedLeadId}
                    activeLeadId={activeLead?.id ?? null}
                    selectedLeadId={selectedLeadId}
                    showStats={showStats}
                    compact
                    dealOrderByLeadId={dealOrderByLeadId}
                    dealSession={dealSession}
                    enableDnD={enableDnD}
                    onMoveLead={enableDnD ? handleMoveLead : undefined}
                    onExpand={setExpandedStageId}
                    isExpanded={expandedStageId === stage.id}
                  />
                </div>
              )
            })}
          </div>

          <div className="absolute bottom-10 right-10 flex items-end gap-5">
            {successStages.map((stage) => {
              const leads = leadsByStage[stage.id] ?? []
              const baseCursor = cursorByStageId[stage.id] ?? 0
              const safeCursor = leads.length > 0 ? baseCursor % leads.length : 0
              return (
                <div key={stage.id} className="w-[104px]">
                  <StageDeckPile
                    stageId={stage.id}
                    stageLabel={stageLabel(stage)}
                    leads={leads}
                    cursor={safeCursor}
                    onStep={stepStage}
                    onSelect={setSelectedLeadId}
                    activeLeadId={activeLead?.id ?? null}
                    selectedLeadId={selectedLeadId}
                    showStats={showStats}
                    compact
                    dealOrderByLeadId={dealOrderByLeadId}
                    dealSession={dealSession}
                    enableDnD={enableDnD}
                    onMoveLead={enableDnD ? handleMoveLead : undefined}
                    onExpand={setExpandedStageId}
                    isExpanded={expandedStageId === stage.id}
                  />
                </div>
              )
            })}
          </div>

          {expandedStageId && (() => {
            const stageLeads = leadsByStage[expandedStageId] ?? []
            const stageInfo = currentStages.find((s) => s.id === expandedStageId)
            if (stageLeads.length === 0) return null

            return (
              <>
                {/* Полупрозрачный бэкдроп — клик вне зоны сворачивает */}
                <div
                  className="absolute inset-0 z-30 rounded-[inherit]"
                  onClick={() => setExpandedStageId(null)}
                />


                {/* Expanded stage keeps cards readable and scrollable instead of clipping them inside the table oval. */}
                <div
                  className="absolute z-30 flex flex-col overflow-hidden rounded-lg border border-[color-mix(in_srgb,var(--gold)_34%,transparent)] bg-[color-mix(in_srgb,var(--green-card)_96%,black)] shadow-[0_18px_54px_rgba(0,0,0,0.45)]"
                  style={{
                    left: '50%',
                    top: '52%',
                    width: 1120,
                    maxWidth: 'calc(100% - 96px)',
                    maxHeight: 430,
                    transform: 'translate(-50%, -50%)',
                  }}
                >
                  <div className="flex shrink-0 items-center justify-between gap-4 bg-[color-mix(in_srgb,var(--green-card-hover)_72%,transparent)] px-5 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-[16px] font-normal uppercase tracking-[0.08em] text-[var(--app-text)]">
                        {stageInfo ? stageLabel(stageInfo) : null}
                      </div>
                      <div className="mt-1 text-[16px] font-normal text-[var(--app-text-muted)]">
                        {t('crmPoker.totalShort')}: {stageLeads.length}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setExpandedStageId(null)}
                      className="flex size-8 shrink-0 items-center justify-center rounded-md border border-[var(--hub-card-border)] bg-[var(--green-card)] text-[var(--app-text-muted)] transition-colors hover:border-[var(--hub-card-border-hover)] hover:text-[var(--app-text)]"
                      title={t('crmPoker.collapseStage')}
                    >
                      <X className="size-4" />
                    </button>
                  </div>

                  <div className="min-h-0 overflow-y-auto px-5 py-4">
                    <div
                      className="grid justify-center gap-3"
                      style={{ gridTemplateColumns: 'repeat(auto-fill, 104px)' }}
                    >
                      {stageLeads.map((lead) => {
                        const isCritical = getLeadProblemState(lead) === "critical"
                        const colId = getLeadStageColumn(lead.stageId)

                        return (
                          <ExpandedStageLeadCard
                            key={lead.id}
                            lead={lead}
                            isCritical={isCritical}
                            showCommission={colId === "in_progress" && lead.commissionUsd != null}
                            draggable={enableDnD}
                            onSelect={() => {
                              setSelectedLeadId(lead.id)
                              setExpandedStageId(null)
                            }}
                          />
                        )
                      })}
                    </div>
                  </div>
                </div>
              </>
            )
          })()}

          </div>
        </div>
      </div>
      )}
    </div>
  )

  const wrapWithDnD = (node: React.ReactNode) =>
    enableDnD ? (
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {node}
        <DragOverlay dropAnimation={null}>
          {draggingLead ? <DraggedCardOverlay lead={draggingLead} /> : null}
        </DragOverlay>
      </DndContext>
    ) : (
      node
    )

  return (
    <>
      {isLoading && <PageOverlay text={t('crmPoker.sync')} />}
      {wrapWithDnD(tableContent)}

      <LeadViewModal
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        lead={activeCrmLead}
        initialTab={leadViewInitialTab}
      />

      {/* Лид не найден на backend (удалён/чужая организация) — см. openLeadDetails */}
      <Dialog open={leadDetailsUnavailable} onOpenChange={(open) => { if (!open) setLeadDetailsUnavailable(false) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('crmPoker.leadDetailsUnavailableTitle', 'Детали недоступны')}</DialogTitle>
            <DialogDescription>
              {t(
                'crmPoker.leadDetailsUnavailableBody',
                'Не удалось загрузить карточку лида. Возможно, лид был удалён.',
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end pt-2">
            <Button variant="outline" onClick={() => setLeadDetailsUnavailable(false)}>
              {t('common.close', 'Закрыть')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Подтверждение передачи лида */}
      <Dialog open={!!transferConfirm} onOpenChange={(open) => { if (!open) setTransferConfirm(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('crmPoker.transferTitle')}</DialogTitle>
            <DialogDescription>
              {transferConfirm && activeLead && (
                transferConfirm.newManagerId
                  ? formatMessage(t('crmPoker.transferToManager'), {
                      lead: activeLead.name ?? activeLead.id,
                      manager: transferConfirm.newManagerName,
                    })
                  : formatMessage(t('crmPoker.unassignLead'), {
                      lead: activeLead.name ?? activeLead.id,
                    })
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setTransferConfirm(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => {
                if (!activeLead || !transferConfirm) return
                if (transferConfirm.newManagerId) {
                  dispatch({ type: "ASSIGN_LEAD", leadId: activeLead.id, managerId: transferConfirm.newManagerId })
                  dispatch({
                    type: "ADD_LEAD_EVENT",
                    leadId: activeLead.id,
                    event: {
                      id: `evt-${Date.now()}`,
                      type: "assign",
                      timestamp: new Date().toISOString(),
                      authorId: "lm-1",
                      authorName: currentUser?.name ?? t('common.userFallback'),
                      payload: {
                        managerId: transferConfirm.newManagerId,
                        managerName: transferConfirm.newManagerName,
                      },
                    },
                  })
                } else {
                  dispatch({ type: "UNASSIGN_LEAD", leadId: activeLead.id })
                }
                setTransferConfirm(null)
              }}
            >
              {t('crmPoker.confirm')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </>
  )
}

// ─── StageDeckPile (карты этапа; при enableDnD — передняя карта тянется, колода — drop-зона) ─────

function StageDeckPile({
  stageId,
  stageLabel,
  stageName,
  leads,
  cursor,
  onStep,
  onSelect,
  activeLeadId,
  selectedLeadId,
  showStats,
  compact = false,
  dealOrderByLeadId = {},
  dealSession = 0,
  enableDnD = false,
  onMoveLead,
  onExpand,
  isExpanded = false,
}: {
  stageId: string
  stageLabel: string
  stageName?: string
  leads: Lead[]
  cursor: number
  onStep: (stageId: string, leads: Lead[], direction: 1 | -1) => void
  onSelect: (leadId: string) => void
  activeLeadId: string | null
  selectedLeadId: string | null
  showStats: boolean
  dealOrderByLeadId?: Record<string, number>
  dealSession?: number
  compact?: boolean
  enableDnD?: boolean
  onMoveLead?: (leadId: string, newStageId: string) => void
  onExpand?: (stageId: string | null) => void
  isExpanded?: boolean
}) {
  const { t } = useI18n()
  const cards = visibleLeadCards(leads, cursor)
  const hiddenCount = Math.max(0, leads.length - cards.length)
  const hiddenLayers = Math.min(compact ? 7 : 10, hiddenCount)
  const deckTone = getDeckVisualState(stageId, leads)

  const totalLeads = leads.length
  const criticalLeads = leads.filter((lead) => getLeadProblemState(lead) === "critical").length
  const columnCommission = leads.reduce((sum, lead) => sum + (lead.commissionUsd ?? 0), 0)

  const cardWidth = compact ? 76 : 95
  const cardHeight = compact ? 114 : 142
  const cardStep = compact ? 22 : 27
  const pileHeight = hiddenLayers * (compact ? 2 : 3) + 4 + cardHeight + (compact ? 6 : 8)

  const columnId = getLeadStageColumn(stageId)
  const hasCompactStageLabel = stageId === "callback" || stageId === "country_discussed"

  const { setNodeRef: setDroppableRef, isOver } = useDroppable(
    enableDnD ? { id: stageId } : { id: `noop-${stageId}` }
  )

  const handleCardSelect = (leadId: string) => {
    if (selectedLeadId === leadId && leads.length > 1) {
      onStep(stageId, leads, 1)
      return
    }
    onSelect(leadId)
  }

  return (
    <>
      <div>
        {onExpand && (
          <div className="mb-1 flex justify-center">
            <button
              onClick={() => onExpand?.(isExpanded ? null : stageId)}
              className={cn(
                "transition-colors focus:outline-none",
                isExpanded
                  ? "text-[var(--gold)] drop-shadow-[0_0_6px_rgba(230,195,100,0.5)]"
                  : "text-[var(--app-text-subtle)] hover:text-[var(--app-text-muted)]"
              )}
              title={isExpanded ? t('crmPoker.collapseStage') : t('crmPoker.expandStage')}
            >
              <Eye className={cn(compact ? "size-3.5" : "size-4", isExpanded && "scale-110")} />
            </button>
          </div>
        )}
        <div className={cn("mb-2 flex items-center justify-center", compact ? "h-8" : "h-5")}>
          <p
            className={cn(
              "text-center font-normal text-[var(--app-text-muted)]",
              compact
                ? hasCompactStageLabel
                  ? "line-clamp-2 text-[10px] leading-tight tracking-[0.01em]"
                  : "line-clamp-2 text-[11px] tracking-wide"
                : hasCompactStageLabel
                  ? "text-[10px] uppercase leading-tight tracking-[0.04em]"
                  : "text-[11px] uppercase tracking-wide"
            )}
          >
            {stageLabel}
          </p>
        </div>
        {!compact && showStats && (
          <div className="mb-1 flex flex-col items-center gap-0.5 [text-shadow:_0_1px_3px_rgba(0,0,0,0.7)]">
            <div className="flex items-center gap-3.5 text-[11px] font-normal leading-none text-[var(--app-text-muted)]">
              <span>{t('crmPoker.totalShort')}: {totalLeads}</span>
              <span className="text-rose-500">{t('crmPoker.problemShort')}: {criticalLeads}</span>
            </div>
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-normal leading-none",
                criticalLeads / Math.max(totalLeads, 1) > 0.5
                  ? "bg-rose-600 text-white"
                  : criticalLeads / Math.max(totalLeads, 1) > 0.25
                    ? "bg-[var(--gold)] text-[var(--gold-btn-text)] border border-[var(--gold-light)]"
                    : "bg-emerald-600 text-white border border-emerald-500"
              )}
            >
              {totalLeads > 0 ? Math.round((criticalLeads / totalLeads) * 100) : 0}% {t('crmPoker.problemShort').toLowerCase()}
            </span>
          </div>
        )}
        {stageName && (
          <div className="flex h-8 items-start justify-center">
            <p className="line-clamp-2 text-center text-[11px] font-normal leading-tight text-[var(--app-text-muted)]">
              {stageName}
            </p>
          </div>
        )}
      </div>
      <div className="mb-4" />

      <div
        ref={enableDnD ? setDroppableRef : undefined}
        className={cn("relative mx-auto transition-all", enableDnD && isOver && "ring-2 ring-[rgba(243,209,139,0.6)] rounded-[14px]")}
        style={{ width: cardWidth, height: pileHeight }}
      >
        {hiddenLayers > 0 &&
          Array.from({ length: hiddenLayers }).map((_, layerIndex) => (
            <span
              key={`back-${stageId}-${layerIndex}`}
              aria-hidden
              className={cn(
                "absolute shadow-[0_3px_8px_rgba(0,0,0,0.25)]",
                compact ? "rounded-[11px]" : "rounded-[14px]",
                "v2-card-back",
                deckTone === "critical" && "border-rose-300/90"
              )}
              style={{
                width: cardWidth,
                height: cardHeight,
                top: layerIndex * (compact ? 2 : 3),
                left: 0,
                zIndex: layerIndex + 1,
              }}
            />
          ))}

        {cards.map((lead, cardIndex) => {
          const isFrontCard = cardIndex === cards.length - 1
          const isCritical = getLeadProblemState(lead) === "critical"
          const dealIndex = dealOrderByLeadId[lead.id] ?? 0
          const delayMs = dealIndex * 70
          const showAsDraggable = enableDnD && isFrontCard && Boolean(onMoveLead) && !isExpanded

          return (
            <StageDeckCard
              key={lead.id + "-" + dealSession}
              lead={lead}
              stageId={stageId}
              compact={compact}
              cardWidth={cardWidth}
              cardHeight={cardHeight}
              isFrontCard={isFrontCard}
              isCritical={isCritical}
              activeLeadId={activeLeadId}
              columnId={columnId}
              hiddenLayers={hiddenLayers}
              cardStep={cardStep}
              cardIndex={cardIndex}
              delayMs={delayMs}
              onSelect={handleCardSelect}
              draggable={showAsDraggable}
            />
          )
        })}

        {leads.length === 0 && (
          <span
            className={cn(
              "v2-card-empty absolute opacity-60",
              compact ? "rounded-[11px]" : "rounded-[14px]"
            )}
            style={{ width: cardWidth, height: cardHeight, top: 0, left: 0 }}
          />
        )}
      </div>

      {!compact && showStats && columnCommission > 0 && (
        <div className="mt-0.5 text-center text-[13px] font-normal leading-none text-[var(--app-text-muted)]">
          {formatUsd(columnCommission)}
        </div>
      )}
    </>
  )
}

function StageDeckCard({
  lead,
  stageId,
  compact,
  cardWidth,
  cardHeight,
  isFrontCard,
  isCritical,
  activeLeadId,
  columnId,
  hiddenLayers,
  cardStep,
  cardIndex,
  delayMs,
  onSelect,
  draggable,
}: {
  lead: Lead
  stageId: string
  compact: boolean
  cardWidth: number
  cardHeight: number
  isFrontCard: boolean
  isCritical: boolean
  activeLeadId: string | null
  columnId: string
  hiddenLayers: number
  cardStep: number
  cardIndex: number
  delayMs: number
  onSelect: (leadId: string) => void
  draggable: boolean
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable(
    draggable ? { id: lead.id, data: { lead, fromStageId: stageId } } : { id: `noop-${lead.id}-${stageId}` }
  )

  const topOffset = hiddenLayers * (compact ? 2 : 3) + 4 + cardIndex * cardStep

  const cardEl = (
    <button
      ref={draggable ? setNodeRef : undefined}
      {...(draggable ? { ...listeners, ...attributes } : {})}
      type="button"
      onClick={() => onSelect(lead.id)}
      className={cn(
        "absolute overflow-hidden px-1.5 py-1.5 text-center shadow-[0_4px_10px_rgba(0,0,0,0.26)] v2-card-face",
        compact ? "rounded-[11px]" : "rounded-[14px]",
        isCritical && "is-critical",
        activeLeadId === lead.id && "ring-2 ring-[rgba(243,209,139,0.6)]",
        draggable && "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-40"
      )}
      style={{
        width: cardWidth,
        height: cardHeight,
        top: topOffset,
        left: 0,
        zIndex: 20 + cardIndex,
        animationName: "dealCard",
        animationDuration: "420ms",
        animationDelay: `${delayMs}ms`,
        animationTimingFunction: "cubic-bezier(0.18, 0.89, 0.32, 1.28)",
        animationFillMode: "backwards",
      }}
	    >
	      {!isFrontCard && (
        <span className="relative z-10 absolute left-1 right-1 top-1 rounded-[4px] border border-[var(--hub-card-border)] bg-[var(--card)]/95 px-1 py-0.5 text-[10px] font-medium leading-none text-[var(--foreground)]">
          <span className="block truncate">{lead.name ?? lead.id}</span>
        </span>
      )}
      <p
        className={cn(
          "relative z-10 font-medium leading-tight text-black",
          compact ? "mt-2 text-[11px]" : "mt-4 text-[13px]",
          isFrontCard ? "line-clamp-3 whitespace-normal break-words" : "line-clamp-2"
        )}
      >
        {lead.name ?? lead.id}
      </p>
      {columnId === "in_progress" && lead.commissionUsd != null && (
        <p className={cn("relative z-10 font-medium text-black", compact ? "mt-0.5 text-[9px]" : "mt-1 text-[10px]")}>
          {formatUsd(lead.commissionUsd)}
        </p>
      )}
    </button>
  )

  return cardEl
}

// ─── ExpandedStageLeadCard (карта в развёрнутом виде этапа — тоже перетаскивается по колонкам) ────

function ExpandedStageLeadCard({
  lead,
  isCritical,
  showCommission,
  draggable,
  onSelect,
}: {
  lead: Lead
  isCritical: boolean
  showCommission: boolean
  draggable: boolean
  onSelect: () => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable(
    draggable ? { id: lead.id, data: { lead } } : { id: `noop-expanded-${lead.id}` }
  )

  return (
    <button
      ref={draggable ? setNodeRef : undefined}
      {...(draggable ? { ...listeners, ...attributes } : {})}
      type="button"
      onClick={onSelect}
      className={cn(
        "shrink-0 overflow-hidden px-2 py-1.5 text-center shadow-[0_4px_12px_rgba(0,0,0,0.35)] v2-card-face rounded-[12px] transition-all hover:scale-105 hover:z-[999] hover:shadow-[0_8px_24px_rgba(0,0,0,0.5)]", // design-ok: масштаб игральной карты, как у соседних карт колоды в этом файле
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        isCritical && "is-critical",
        isDragging && "opacity-40"
      )}
      style={{ width: 104, height: 150 }}
    >
      <p className="relative z-10 mt-5 text-[12px] font-medium leading-tight text-black line-clamp-4 whitespace-normal break-words">{/* design-ok: масштаб игральной карты */}
        {lead.name ?? lead.id}
      </p>
      {showCommission && (
        <p className="relative z-10 mt-1 text-[10px] font-medium text-black">{/* design-ok: масштаб игральной карты */}
          {formatUsd(lead.commissionUsd)}
        </p>
      )}
    </button>
  )
}
