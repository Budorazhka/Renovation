import { ProductType, LeadStage } from '../../../services/api';
import ReportsBlock from '../../../components/crm/ReportsBlock';
import LibrarySelectorBlock from '../../../components/crm/LibrarySelectorBlock';
import NotesBlock from '../../../components/crm/NotesBlock';
import CalendarBlock from '../../../components/crm/CalendarBlock';
import AskQuestionButton from '../../../components/crm/AskQuestionButton';
import LeadsBlock from '../../../components/crm/LeadsBlock';
import TasksBlock from '../../../components/crm/TasksBlock';
import NotificationsBlock from '../../../components/crm/NotificationsBlock';
import type { Task, Lead } from '../../../services/api';
import type { TaskStatus } from '../../../services/api';
import { useI18n } from '@/i18n';

export type ProductTab = 'RP' | 'Net' | 'Owner' | 'Agent';

export interface CrmLeftSidebarProps {
  // ReportsBlock
  backendTasks: Task[];
  backendLeads: Lead[];
  onModalOpen: () => void;
  // LibrarySelectorBlock
  selectedProductForLibrary: ProductTab;
  // LeadsBlock (mobile)
  onUpdateLeads: (leads: Lead[]) => void;
  onUpdateLead: (leadId: string, updates: Partial<Lead>, modifiedFields: string[]) => void;
  onUpdateLeadAfterSync: (leadId: string, syncedLead: Lead) => void;
  onLoadLeads: () => Promise<void>;
  onLeadStageChange: (leadId: string, leadName: string, stageLabel: string, stage: LeadStage, productType: ProductType) => void;
  onOpenNewTaskModalWithLead: (leadId: string) => void;
  onOpenTaskManagementModal: () => void;
  activeLeadId?: string;
  onLeadDeleted: (leadId: string) => Promise<void>;
  onProductChange: (product: ProductTab) => void;
  onCloseChecklist: () => void;
  // TasksBlock (mobile)
  lastUpdateTime: Date;
  onUpdateTaskStatus: (taskId: string, status: TaskStatus) => Promise<void>;
  onDeleteTask: (taskId: string) => Promise<void>;
  onOpenNewTaskModal: () => void;
  onTaskUpdate: (updatedTask: Task) => void;
  onUpdateTaskEndDate: (taskId: string, endDate: string | undefined) => Promise<void>;
  onOpenTaskView: (taskId: string) => void;
  // NotesBlock
  onOpenNewTaskModalFromNote: (noteData: {
    title: string;
    description: string;
    leadId?: string;
    taskType?: 'standard' | 'call' | 'meeting';
    noteId?: string;
    files?: Array<{ originalName: string; filename: string; mimeType: string; size: number }>;
  }) => void;
  logout: () => void;
}

const CrmLeftSidebar = ({
  backendTasks,
  backendLeads,
  onModalOpen,
  selectedProductForLibrary,
  onUpdateLeads,
  onUpdateLead,
  onUpdateLeadAfterSync,
  onLoadLeads,
  onLeadStageChange,
  onOpenNewTaskModalWithLead,
  onOpenTaskManagementModal,
  activeLeadId,
  onLeadDeleted,
  onProductChange,
  onCloseChecklist,
  lastUpdateTime,
  onUpdateTaskStatus,
  onDeleteTask,
  onOpenNewTaskModal,
  onTaskUpdate,
  onUpdateTaskEndDate,
  onOpenTaskView,
  onOpenNewTaskModalFromNote,
  logout,
}: CrmLeftSidebarProps) => {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-y-2 w-full md:w-78 md:flex-shrink-0 crm-left-col">
      <div className="crm-sidebar-logout flex items-center gap-2 py-1">
        <button
          type="button"
          onClick={logout}
          className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-base text-[rgba(255,255,255,0.72)] transition-colors hover:bg-[var(--secondary)] hover:text-[color:var(--foreground)]"
          title={t('navigation.logout')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="hidden md:inline">{t('navigation.logout')}</span>
        </button>
      </div>
      {/* Desktop blocks */}
      <div className="crm-sidebar-report hidden md:block">
        <ReportsBlock tasks={backendTasks} onModalOpen={onModalOpen} />
      </div>
      <div className="crm-sidebar-library mt-3 hidden md:block">
        <LibrarySelectorBlock
          productType={
            selectedProductForLibrary === 'Net'
              ? ProductType.NETWORK
              : selectedProductForLibrary === 'Owner'
                ? ProductType.OWNER
                : selectedProductForLibrary === 'Agent'
                  ? ProductType.AGENT
                  : ProductType.SALES
          }
          onModalOpen={onModalOpen}
        />
      </div>
      <div className="crm-sidebar-calendar mt-4 relative hidden md:block">
        <CalendarBlock onModalOpen={onModalOpen} />
      </div>
      <div className="crm-sidebar-notes mt-4 hidden md:block">
        <NotesBlock onOpenNewTaskModalFromNote={onOpenNewTaskModalFromNote} />
      </div>
      <div className="crm-sidebar-ask mt-4 mb-5 hidden md:block">
        <AskQuestionButton />
      </div>

      {/* Mobile blocks */}
      <div className="mt-4 md:hidden">
        <LeadsBlock
          backendLeads={backendLeads}
          onUpdateLeads={onUpdateLeads}
          onUpdateLead={onUpdateLead}
          onUpdateLeadAfterSync={onUpdateLeadAfterSync}
          onLoadLeads={onLoadLeads}
          onLeadStageChange={onLeadStageChange}
          onOpenNewTaskModal={onOpenNewTaskModalWithLead}
          onOpenTaskManagementModal={onOpenTaskManagementModal}
          activeLeadId={activeLeadId}
          onLeadDeleted={onLeadDeleted}
          onProductChange={onProductChange}
          onCloseChecklist={onCloseChecklist}
        />
      </div>
      <div className="mt-4 md:hidden">
        <TasksBlock
          tasks={backendTasks}
          lastUpdateTime={lastUpdateTime}
          onUpdateTaskStatus={onUpdateTaskStatus}
          onDeleteTask={onDeleteTask}
          onOpenNewTaskModal={onOpenNewTaskModal}
          onOpenTaskManagementModal={onOpenTaskManagementModal}
          onTaskUpdate={onTaskUpdate}
          onUpdateTaskEndDate={onUpdateTaskEndDate}
          onOpenTaskView={onOpenTaskView}
        />
      </div>
      <div className="mt-4 md:hidden">
        <NotificationsBlock onOpenTaskView={onOpenTaskView} />
      </div>
      <div className="mt-4 mb-5 md:hidden">
        <NotesBlock onOpenNewTaskModalFromNote={onOpenNewTaskModalFromNote} />
      </div>
    </div>
  );
};

export default CrmLeftSidebar;
