import { lazy, Suspense, useEffect } from "react";
import { useDisableScroll } from '../../hooks/useDisableScroll';
import CrmModals from './components/CrmModals';
import { useCrmPage } from './hooks';
import type { Task } from '../../services/api';
import { useI18n } from "@/i18n";

const CrmLeftSidebar = lazy(() => import('./components/CrmLeftSidebar'));
const CrmRightContent = lazy(() => import('./components/CrmRightContent'));

const PageCrm = () => {
    const { t } = useI18n();
  const s = useCrmPage();

  useEffect(() => {
    if (s.isAuthenticated) {
      import('./components/CrmLeftSidebar');
      import('./components/CrmRightContent');
    }
  }, [s.isAuthenticated]);
  useDisableScroll(s.isNewTaskModalOpen || s.isTaskViewModalOpen || s.isUnsavedChangesModalOpen ||
    s.isPropertyModalOpen || s.isColorModalOpen);

  if (!s.isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[var(--background)]">
        <div className="text-center px-4">
          <h2 className="text-xl font-medium text-[color:var(--foreground)] mb-2">
            {t('crm.crm.pageCrmFullDesign.необходима_авторизац')}</h2>
          <p className="text-base text-[rgba(255,255,255,0.72)]">
            {t('crm.crm.pageCrmFullDesign.пожалуйста_войдите_в')}</p>
        </div>
      </div>
    );
  }

  if (s.authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[var(--background)]">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-4 border-[color-mix(in_srgb,var(--primary)_70%,transparent)] border-t-transparent rounded-full mx-auto mb-4" aria-hidden />
          <p className="text-base text-[rgba(255,255,255,0.72)]">{t('crm.crm.pageCrmFullDesign.загрузка_данных')}</p>
        </div>
      </div>
    );
  }
  // Намеренно НЕ ждём s.dataLoading здесь — данные подгружаются в фоне,
  // а в углу отображается компактный индикатор `isDataLoading`. Это убирает
  // паузу при заходе в CRM, особенно в демо без бэкенда (API падает в таймаут).

  return (
    <div className="crm-app crm-classic-compact flex h-full min-h-0 min-w-0 max-w-full flex-col overflow-hidden">
      <div className="crm-classic-viewport flex w-full min-w-0 max-w-full flex-1 flex-col items-stretch justify-start overflow-hidden bg-[var(--background)] p-5 pb-20 md:pb-5">
        {s.isDataLoading && (
          <div className="fixed top-4 right-4 z-50 bg-[var(--card)] shadow-lg rounded-lg p-3 flex items-center gap-2 border border-[var(--border)]">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-[var(--primary)]"></div>
            <span className="text-base text-[rgba(255,255,255,0.92)]">{t('crm.crm.pageCrmFullDesign.загрузка_данных')}</span>
          </div>
        )}

        <div className="crm-main-container flex h-full min-h-0 w-full min-w-0 max-w-full flex-col gap-5 overflow-hidden md:flex-row">
        <Suspense fallback={
          <div className="flex flex-col gap-y-2 w-full md:w-78 md:flex-shrink-0 crm-left-col animate-pulse">
            <div className="h-10 rounded-md w-3/4 bg-[var(--secondary)] shadow-[inset_0_0_0_1px_rgba(201,168,76,0.08)]" />
            <div className="h-32 rounded-lg mt-4 bg-[var(--card)] shadow-[inset_0_0_0_1px_rgba(201,168,76,0.08)]" />
            <div className="h-24 rounded-lg mt-3 bg-[var(--card)] shadow-[inset_0_0_0_1px_rgba(201,168,76,0.08)]" />
          </div>
        }>
          <CrmLeftSidebar
            backendTasks={s.backendTasks}
            backendLeads={s.backendLeads}
            onModalOpen={s.handleCloseOverlay}
            selectedProductForLibrary={s.selectedProductForLibrary}
            onUpdateLeads={s.handleUpdateLeads}
            onUpdateLead={s.handleUpdateLead}
            onUpdateLeadAfterSync={s.handleUpdateLeadAfterSync}
            onLoadLeads={s.loadLeads}
            onLeadStageChange={s.handleLeadStageChange}
            onOpenNewTaskModalWithLead={s.handleOpenNewTaskModalWithLead}
            onOpenTaskManagementModal={s.handleOpenTaskManagementModal}
            activeLeadId={s.leadStageOverlay?.leadId}
            onLeadDeleted={s.handleLeadDeleted}
            onProductChange={(product) => {
              s.setSelectedProductForLibrary(product);
              s.previousProductRef.current = product;
            }}
            onCloseChecklist={s.handleCloseOverlay}
            lastUpdateTime={s.lastUpdateTime}
            onUpdateTaskStatus={s.updateTaskStatus}
            onDeleteTask={s.handleDeleteTask}
            onOpenNewTaskModal={s.handleOpenNewTaskModal}
            onTaskUpdate={s.handleTaskUpdate}
            onUpdateTaskEndDate={s.updateTaskEndDate}
            onOpenTaskView={s.handleOpenTaskView}
            onOpenNewTaskModalFromNote={s.handleOpenNewTaskModalFromNote}
            logout={s.logout}
          />
        </Suspense>
        <Suspense fallback={
          <div className="flex flex-col w-full md:flex-1 min-w-0 crm-right-col animate-pulse">
            <div className="h-48 rounded-lg bg-[var(--card)] shadow-[inset_0_0_0_1px_rgba(201,168,76,0.08)]" />
            <div className="h-64 rounded-lg mt-4 bg-[var(--card)] shadow-[inset_0_0_0_1px_rgba(201,168,76,0.08)]" />
          </div>
        }>
          <CrmRightContent
            backendTasks={s.backendTasks}
            backendLeads={s.backendLeads}
            lastUpdateTime={s.lastUpdateTime}
            onUpdateTaskStatus={s.updateTaskStatus}
            onDeleteTask={s.handleDeleteTask}
            onOpenNewTaskModal={s.handleOpenNewTaskModal}
            onOpenTaskManagementModal={s.handleOpenTaskManagementModal}
            onTaskUpdate={s.handleTaskUpdate}
            onUpdateTaskEndDate={s.updateTaskEndDate}
            onOpenTaskView={s.handleOpenTaskView}
            onUpdateLeads={s.handleUpdateLeads}
            onUpdateLead={s.handleUpdateLead}
            onUpdateLeadAfterSync={s.handleUpdateLeadAfterSync}
            onLoadLeads={s.loadLeads}
            onLeadStageChange={s.handleLeadStageChange}
            onOpenNewTaskModalWithLead={s.handleOpenNewTaskModalWithLead}
            activeLeadId={s.leadStageOverlay?.leadId}
            onLeadDeleted={s.handleLeadDeleted}
            onProductChange={(product) => {
              s.setSelectedProductForLibrary(product);
              s.previousProductRef.current = product;
            }}
            onCloseChecklist={s.handleCloseOverlay}
          />
        </Suspense>
        </div>

        <CrmModals
        isNewTaskModalOpen={s.isNewTaskModalOpen}
        isCallMeetingModalOpen={s.isCallMeetingModalOpen}
        newTaskModalProps={{
          isOpen: s.isNewTaskModalOpen && !s.isCallMeetingModalOpen,
          onClose: s.handleCloseModal,
          taskForm: s.taskForm,
          setTaskForm: s.setTaskForm,
          backendTasks: s.backendTasks,
          backendLeads: s.backendLeads,
          modalTasksData: s.filteredModalTasksData,
          modalTaskChecked: s.modalTaskChecked,
          setModalTaskChecked: s.setModalTaskChecked,
          taskViewMode: s.taskViewMode,
          setTaskViewMode: s.setTaskViewMode,
          taskCategoryFilter: s.taskCategoryFilter,
          setTaskCategoryFilter: s.setTaskCategoryFilter,
          isSearchChecked: s.isSearchChecked,
          setIsSearchChecked: s.setIsSearchChecked,
          selectedTaskFilter: s.selectedTaskFilter,
          setSelectedTaskFilter: s.setSelectedTaskFilter,
          showCreateTask: s.showCreateTask,
          setShowCreateTask: s.setShowCreateTask,
          isTaskManagementOpened: s.isTaskManagementOpened,
          setIsTaskManagementOpened: s.setIsTaskManagementOpened,
          showTaskTypeSelection: s.showTaskTypeSelection,
          setShowTaskTypeSelection: s.setShowTaskTypeSelection,
          handleTaskTypeSelected: s.handleTaskTypeSelected,
          handleCreateTask: s.handleCreateTask,
          handleOpenTaskView: s.handleOpenTaskView,
          handleDeleteTask: s.handleDeleteTask,
          updateTaskStatus: s.updateTaskStatus,
          updateTaskPriority: s.updateTaskPriority,
          resetTaskForm: s.resetTaskForm,
          selectedTaskFiles: s.selectedTaskFiles,
          setSelectedTaskFiles: s.setSelectedTaskFiles,
          isUploadingFiles: s.isUploadingFiles,
          handleTaskFileSelect: s.handleTaskFileSelect,
          handleRemoveTaskFile: s.handleRemoveTaskFile,
          formatFileSize: s.formatFileSize,
          taskFileInputRef: s.taskFileInputRef,
          handleAddSubtask: s.handleAddSubtask,
          handleToggleSubtask: s.handleToggleSubtask,
          handleRemoveSubtask: s.handleRemoveSubtask,
          editingSubtaskIndex: s.editingSubtaskIndex,
          setEditingSubtaskIndex: s.setEditingSubtaskIndex,
          editingSubtaskTitle: s.editingSubtaskTitle,
          setEditingSubtaskTitle: s.setEditingSubtaskTitle,
          handleStartEditSubtask: s.handleStartEditSubtask,
          handleStartAddSubtask: s.handleStartAddSubtask,
          handleSaveEditSubtask: s.handleSaveEditSubtask,
          handleCancelEditSubtask: s.handleCancelEditSubtask,
          isSubtaskInputVisible: s.isSubtaskInputVisible,
          setIsSubtaskInputVisible: s.setIsSubtaskInputVisible,
          newSubtaskTitle: s.newSubtaskTitle,
          setNewSubtaskTitle: s.setNewSubtaskTitle,
          showDescriptionField: s.showDescriptionField,
          setShowDescriptionField: s.setShowDescriptionField,
          isClientDropdownOpen: s.isClientDropdownOpen,
          setIsClientDropdownOpen: s.setIsClientDropdownOpen,
          isCategoryDropdownOpen: s.isCategoryDropdownOpen,
          setIsCategoryDropdownOpen: s.setIsCategoryDropdownOpen,
          clientDropdownRef: s.clientDropdownRef,
          categoryDropdownRef: s.categoryDropdownRef,
          isPhoneSearchOpen: s.isPhoneSearchOpen,
          setIsPhoneSearchOpen: s.setIsPhoneSearchOpen,
          phoneSearchRef: s.phoneSearchRef,
          colorPalette: s.colorPalette,
          setColorPalette: s.setColorPalette,
          isColorModalOpen: s.isColorModalOpen,
          setIsColorModalOpen: s.setIsColorModalOpen,
          isColorPaletteModalOpen: s.isColorPaletteModalOpen,
          setIsColorPaletteModalOpen: s.setIsColorPaletteModalOpen,
          newColorHex: s.newColorHex,
          setNewColorHex: s.setNewColorHex,
          carouselSlide: s.carouselSlide,
          setCarouselSlide: s.setCarouselSlide,
          modalContainerRef: s.modalContainerRef,
          handleTouchStart: s.handleTouchStart,
          handleTouchEnd: s.handleTouchEnd,
          handleTaskDragStart: s.handleTaskDragStart,
          handleTaskDrop: s.handleTaskDrop,
          handleTaskDragEnd: s.handleTaskDragEnd,
          allowDrop: s.allowDrop,
          draggedOverQuadrant: s.draggedOverQuadrant,
          setDraggedOverQuadrant: s.setDraggedOverQuadrant,
          modalTaskCategories: s.modalTaskCategories,
          taskCategoryById: s.taskCategoryById,
          setTaskCategoryById: s.setTaskCategoryById,
          isStartDateExpanded: s.isStartDateExpanded,
          setIsStartDateExpanded: s.setIsStartDateExpanded,
          isStartTimeExpanded: s.isStartTimeExpanded,
          setIsStartTimeExpanded: s.setIsStartTimeExpanded,
          isEndDateExpanded: s.isEndDateExpanded,
          setIsEndDateExpanded: s.setIsEndDateExpanded,
          isEndTimeExpanded: s.isEndTimeExpanded,
          setIsEndTimeExpanded: s.setIsEndTimeExpanded,
          startDateRef: s.startDateRef,
          startTimeRef: s.startTimeRef,
          endDateRef: s.endDateRef,
          endTimeRef: s.endTimeRef,
          filteredModalTasksData: s.filteredModalTasksData,
          draftNotice: s.isDraftLoaded,
          onDismissDraftNotice: () => s.setIsDraftLoaded(false),
        }}
        isTaskViewModalOpen={s.isTaskViewModalOpen}
        selectedTaskForView={s.selectedTaskForView}
        backendTasks={s.backendTasks}
        taskViewModalProps={{
          task: s.selectedTaskForView ? s.backendTasks.find((t: Task) => t._id === s.selectedTaskForView) : undefined,
          isOpen: s.isTaskViewModalOpen,
          onClose: s.handleCloseTaskView,
          onUpdateTaskStatus: s.updateTaskStatus,
          onTaskUpdate: s.handleTaskUpdate,
          onTaskRestored: s.handleTaskRestored,
          onDeleteTask: s.handleDeleteTask,
          onUpdateTaskEndDate: s.updateTaskEndDate,
          colorPalette: s.colorPalette,
          setColorPalette: s.setColorPalette,
          isColorModalOpen: s.isColorModalOpen,
          setIsColorModalOpen: s.setIsColorModalOpen,
          isColorPaletteModalOpen: s.isColorPaletteModalOpen,
          setIsColorPaletteModalOpen: s.setIsColorPaletteModalOpen,
          newColorHex: s.newColorHex,
          setNewColorHex: s.setNewColorHex,
        }}
        selectedTaskType={s.selectedTaskType}
        callMeetingModalProps={{
          isOpen: s.isCallMeetingModalOpen,
          onClose: s.handleCloseModal,
          taskType: s.selectedTaskType as 'call' | 'meeting',
          taskForm: s.taskForm,
          setTaskForm: s.setTaskForm,
          handleCreateTask: s.handleCreateTask,
          backendLeads: s.backendLeads,
          selectedTaskFiles: s.selectedTaskFiles,
          setSelectedTaskFiles: s.setSelectedTaskFiles,
          handleTaskFileSelect: s.handleTaskFileSelect,
          handleRemoveTaskFile: s.handleRemoveTaskFile,
          formatFileSize: s.formatFileSize,
          taskFileInputRef: s.taskFileInputRef,
          colorPalette: s.colorPalette,
          setColorPalette: s.setColorPalette,
          isColorModalOpen: s.isColorModalOpen,
          setIsColorModalOpen: s.setIsColorModalOpen,
          isColorPaletteModalOpen: s.isColorPaletteModalOpen,
          setIsColorPaletteModalOpen: s.setIsColorPaletteModalOpen,
          newColorHex: s.newColorHex,
          setNewColorHex: s.setNewColorHex,
          isDraftLoaded: s.isDraftLoaded,
          setIsDraftLoaded: s.setIsDraftLoaded,
        }}
        isUnsavedChangesModalOpen={s.isUnsavedChangesModalOpen}
        onDiscardChanges={s.handleDiscardChanges}
        onSaveAndClose={s.handleSaveAndClose}
        isPropertyModalOpen={s.isPropertyModalOpen}
        newPropertyName={s.newPropertyName}
        onNewPropertyNameChange={s.setNewPropertyName}
        onAddProperty={s.handleAddProperty}
        onClosePropertyModal={() => s.setIsPropertyModalOpen(false)}
        showCloseChecklistConfirm={s.showCloseChecklistConfirm}
        onCancelCloseChecklist={s.handleCancelCloseChecklist}
        onConfirmCloseChecklist={s.handleConfirmCloseChecklist}
        leadStageOverlay={s.leadStageOverlay}
        onCloseOverlay={s.handleCloseOverlay}
        isLoadingFiles={s.isLoadingFiles}
        fileLoadingProgress={s.fileLoadingProgress}
        />
      </div>
    </div>
  );
};

export default PageCrm;
