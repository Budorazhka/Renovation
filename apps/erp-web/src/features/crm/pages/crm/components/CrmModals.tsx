import TaskViewModal from '../../../components/crm/TaskViewModal';
import LeadStageChecklist from '../../../components/crm/LeadStageChecklist';
import { NewTaskModal } from '../../../components/crm/modals';
import { CallMeetingTaskModal } from '../../../components/crm/modals/CallMeetingTaskModal';
import CircularProgress from '../../../components/crm/CircularProgress';
import { formatTimeRemaining } from '../../../utils/taskFormUtils';
import type { Task } from '../../../services/api';
import type { LeadStage, ProductType } from '../../../services/api';
import { useI18n } from "@/i18n";

export interface CrmModalsProps {
  // NewTaskModal
  isNewTaskModalOpen: boolean;
  isCallMeetingModalOpen: boolean;
  newTaskModalProps: Record<string, unknown>;
  // TaskViewModal
  isTaskViewModalOpen: boolean;
  selectedTaskForView: string | null;
  backendTasks: Task[];
  taskViewModalProps: Record<string, unknown>;
  // CallMeetingTaskModal
  selectedTaskType: 'standard' | 'call' | 'meeting' | null;
  callMeetingModalProps: Record<string, unknown>;
  // UnsavedChangesModal
  isUnsavedChangesModalOpen: boolean;
  onDiscardChanges: () => void;
  onSaveAndClose: () => void;
  // PropertyModal
  isPropertyModalOpen: boolean;
  newPropertyName: string;
  onNewPropertyNameChange: (value: string) => void;
  onAddProperty: () => void;
  onClosePropertyModal: () => void;
  // CloseChecklistConfirm
  showCloseChecklistConfirm: boolean;
  onCancelCloseChecklist: () => void;
  onConfirmCloseChecklist: () => void;
  // LeadStageChecklist overlay
  leadStageOverlay: { leadId: string; leadName: string; stageLabel: string; stage: LeadStage; productType: ProductType } | null;
  onCloseOverlay: () => void;
  // File loading modal
  isLoadingFiles: boolean;
  fileLoadingProgress: {
    percentage: number;
    loaded: number;
    total: number;
    remainingFiles: number;
    estimatedTimeRemaining: number;
    currentFileName: string;
  };
}

const CrmModals = ({
  isNewTaskModalOpen,
  isCallMeetingModalOpen,
  newTaskModalProps,
  isTaskViewModalOpen,
  selectedTaskForView: _selectedTaskForView,
  backendTasks: _backendTasks,
  taskViewModalProps,
  selectedTaskType,
  callMeetingModalProps,
  isUnsavedChangesModalOpen,
  onDiscardChanges,
  onSaveAndClose,
  isPropertyModalOpen,
  newPropertyName,
  onNewPropertyNameChange,
  onAddProperty,
  onClosePropertyModal,
  showCloseChecklistConfirm,
  onCancelCloseChecklist,
  onConfirmCloseChecklist,
  leadStageOverlay,
  onCloseOverlay,
  isLoadingFiles,
  fileLoadingProgress,
}: CrmModalsProps) => {
  const { t } = useI18n();
  return (
  <>
    {isNewTaskModalOpen && !isCallMeetingModalOpen && (
      <NewTaskModal {...(newTaskModalProps as any)} />
    )}

    {isPropertyModalOpen && (
      <div className="modal-fade-in fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[80] pt-4 md:pt-4 pb-0 md:pb-4 px-0 md:px-4" onClick={onClosePropertyModal}>
        <div className="relative flex flex-col bg-white rounded-[25px] shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
          <div className="flex justify-between items-center px-12.5 py-4 border-b border-gray-200">
            <span className="text-dream-primary text-lg font-normal">{t('crm.crm.crmModals.добавить_категорию')}</span>
          </div>
          <div className="flex-1 flex flex-col justify-center items-center px-12.5 py-8">
            <div className="w-full max-w-md">
              <div className="relative w-full mb-6">
                <input
                  type="text"
                  placeholder={t('crm.crm.crmModals.название_категории')}
                  value={newPropertyName}
                  onChange={(e) => onNewPropertyNameChange(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && onAddProperty()}
                  className="w-full border-2 border-dream-primary bg-dream-secondary rounded-full pl-5 pr-5 py-3 focus:outline-none text-lg"
                />
              </div>
              <button
                onClick={onAddProperty}
                className="w-full bg-dream-primary text-white rounded-full py-3 px-5 hover:bg-green-700 transition-colors text-lg font-normal"
              >
                {t('crm.crm.crmModals.добавить')}</button>
            </div>
          </div>
        </div>
      </div>
    )}

    {isTaskViewModalOpen && (
      <TaskViewModal {...(taskViewModalProps as any)} />
    )}

    {isCallMeetingModalOpen && selectedTaskType && (
      <CallMeetingTaskModal {...(callMeetingModalProps as any)} />
    )}

    {isUnsavedChangesModalOpen && (
      <div className="modal-fade-in fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[70] pt-4 md:pt-4 pb-0 md:pb-4 px-0 md:px-4" onClick={onDiscardChanges}>
        <div className="relative flex flex-col bg-white rounded-[25px] shadow-2xl overflow-hidden max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
          <div className="flex justify-between items-center px-12.5 py-4 border-b border-gray-200">
            <span className="text-dream-primary text-lg font-normal">{t('crm.crm.crmModals.несохраненные_измене')}</span>
          </div>
          <div className="flex-1 flex flex-col justify-center items-center px-12.5 py-8">
            <div className="w-full">
              <p className="text-gray-800 text-lg mb-6 text-center">
                {t('crm.crm.crmModals.у_вас_есть_несохране')}</p>
              <div className="flex gap-4">
                <button onClick={onDiscardChanges} className="flex-1 bg-gray-200 text-gray-800 rounded-full py-3 px-5 hover:bg-gray-300 transition-colors text-lg font-normal">{t('crm.crm.crmModals.нет')}</button>
                <button onClick={onSaveAndClose} className="flex-1 bg-dream-primary text-white rounded-full py-3 px-5 hover:bg-green-700 transition-colors text-lg font-normal">{t('crm.crm.crmModals.да')}</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )}

    {showCloseChecklistConfirm && (
      <div className="modal-fade-in fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[70] pt-4 md:pt-4 pb-0 md:pb-4 px-0 md:px-4" onClick={onCancelCloseChecklist}>
        <div className="relative flex flex-col bg-white rounded-[25px] shadow-2xl overflow-hidden max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
          <div className="flex justify-between items-center px-12.5 py-4 border-b border-gray-200">
            <span className="text-dream-primary text-lg font-normal">{t('crm.crm.crmModals.закрыть_чеклист')}</span>
          </div>
          <div className="flex-1 flex flex-col justify-center items-center px-12.5 py-8">
            <div className="w-full">
              <div className="flex gap-4">
                <button onClick={onCancelCloseChecklist} className="flex-1 bg-gray-200 text-gray-800 rounded-full py-3 px-5 hover:bg-gray-300 transition-colors text-lg font-normal">{t('crm.crm.crmModals.нет')}</button>
                <button onClick={onConfirmCloseChecklist} className="flex-1 bg-dream-primary text-white rounded-full py-3 px-5 hover:bg-green-700 transition-colors text-lg font-normal">{t('crm.crm.crmModals.да')}</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )}

    {leadStageOverlay && (
      <div
        className="fixed top-4 bg-white rounded-[25px] z-[99999] flex flex-col shadow-lg p-6 animate-fade-in h-81 overflow-y-auto"
        style={{ left: 'calc(19.5rem + 1.25rem + 1.25rem)', right: '1.25rem' }}
      >
        <div className="absolute top-4 right-4 z-10 group">
          <button onClick={onCloseOverlay} className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors" aria-label={t('crm.crm.crmModals.закрыть')}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <div className="tooltip absolute top-full right-0 mt-2 px-3 py-1.5 bg-gray-800 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-[99999] shadow-xl">
            {t('crm.crm.crmModals.закрытие_чек_листа')}</div>
        </div>
        <LeadStageChecklist
          key={`${leadStageOverlay.leadId}-${leadStageOverlay.stage}`}
          leadId={leadStageOverlay.leadId}
          leadName={leadStageOverlay.leadName}
          stage={leadStageOverlay.stage}
          productType={leadStageOverlay.productType}
          onCloseChecklist={onCloseOverlay}
        />
      </div>
    )}

    {isLoadingFiles && (
      <div className="modal-fade-in fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[90] pt-4 md:pt-4 pb-0 md:pb-4 px-0 md:px-4">
        <div className="relative flex flex-col bg-white rounded-[25px] shadow-2xl overflow-hidden max-w-md w-full mx-4 p-6 md:p-8" onClick={(e) => e.stopPropagation()}>
          <div className="flex flex-col items-center gap-6">
            <h2 className="text-center text-xl font-normal" style={{ fontFamily: 'var(--font-sans)', fontWeight: 400, fontSize: '22px', lineHeight: '100%', color: '#151515' }}>
              {t('crm.crm.crmModals.загрузка_файлов')}</h2>
            <CircularProgress percentage={fileLoadingProgress.percentage} size={140} strokeWidth={12} />
            <div className="w-full flex flex-col gap-3">
              {fileLoadingProgress.currentFileName && (
                <p className="text-sm text-gray-600 text-center truncate" title={fileLoadingProgress.currentFileName}>
                  {t('crm.crm.crmModals.загружается')}{fileLoadingProgress.currentFileName}
                </p>
              )}
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">{t('crm.crm.crmModals.загружено_файлов')}</span>
                <span className="font-normal text-dream-primary">{fileLoadingProgress.loaded} / {fileLoadingProgress.total}</span>
              </div>
              {fileLoadingProgress.remainingFiles > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">{t('crm.crm.crmModals.осталось_файлов')}</span>
                  <span className="font-normal text-gray-700">{fileLoadingProgress.remainingFiles}</span>
                </div>
              )}
              {fileLoadingProgress.estimatedTimeRemaining > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">{t('crm.crm.crmModals.примерное_время')}</span>
                  <span className="font-normal text-gray-700">{formatTimeRemaining(fileLoadingProgress.estimatedTimeRemaining)}</span>
                </div>
              )}
              <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden mt-2">
                <div className="h-full bg-dream-primary transition-all duration-300 ease-out rounded-full" style={{ width: `${fileLoadingProgress.percentage}%` }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    )}
  </>
  );
};

export default CrmModals;
