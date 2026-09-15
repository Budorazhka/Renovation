import React, { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { LeadStage, ProductType, type LeadFile, type LibraryFolder } from '../../services/api';
import { leadCrmService, openLeadFile } from '../../services/leadsCrmV2';
import { libraryCrmService } from '../../services/libraryCrmV2';
import { findRejectedUpload, UPLOAD_ACCEPT } from '@/lib/open-signed-file';
import { useToast } from '../common/Toast';
import { DeleteConfirmModal } from './modals/DeleteConfirmModal';
import {
  FileText,
  Image as ImageIcon,
  File,
  Music,
  Video,
  Archive,
  FileSpreadsheet,
  Download,
  Folder,
  FolderPlus,
  Trash2
} from 'lucide-react';
import { useI18n } from '@/i18n';

interface ChecklistTask {
  label: string;
  weights: number[];
}

interface ChecklistItem {
  correct: ChecklistTask[];
  incorrect: ChecklistTask[];
}

const createChecklistTask = (label: string, weights: number[] = [0, 0, 0, 0, 0, 0]): ChecklistTask => ({
  label,
  weights,
});

interface LeadStageChecklistProps {
  leadId: string;
  leadName?: string; // Опциональный, может использоваться в будущем
  stageLabel?: string; // Опциональный, метка этапа
  stage: LeadStage;
  productType?: ProductType; // Опциональный, может использоваться в будущем
  selectedProduct?: 'RP' | 'Net'; // Опциональный, выбранный продукт
  onClose?: () => void; // Колбэк для закрытия
  onDirectClose?: () => void; // Колбэк для прямого закрытия
  onCommentSaved?: () => void; // Колбэк для обновления истории после сохранения комментария
  onCloseChecklist?: () => void; // Колбэк для закрытия чеклиста при открытии библиотеки
}

// Данные чеклиста для каждого этапа воронки продаж
const checklistData: Record<LeadStage, ChecklistItem> = {
  [LeadStage.REJECTED]: {
    correct: [
      createChecklistTask('Проверить корректность номера телефона'),
      createChecklistTask('Проверить корректность телефона, e-mail, имени, запроса'),
      createChecklistTask('Убедиться, что заявка не сформировалась ошибочно в интеграции'),
      createChecklistTask('Отметить причину брака в CRM (не существует номер/ошибка/спам/бот)'),
      createChecklistTask('При повторяющихся случаях — передать инфо маркетологу или руководителю'),
      createChecklistTask('Внести всю информацию в CRM'),
    ],
    incorrect: [],
  },
  [LeadStage.FIRST_CONTACT]: {
    correct: [
      createChecklistTask('Уточнить причину отказа'),
      createChecklistTask('Переформулировать и проверить понимание'),
      createChecklistTask('Коротко предложить альтернативу'),
      createChecklistTask('Зафиксировать в CRM: причина + что важно клиенту в будущем'),
    ],
    incorrect: [],
  },
  [LeadStage.QUALIFICATION]: {
    correct: [
      createChecklistTask('Совершить 3-й звонок на следующий день'),
      createChecklistTask('Отправить финальное нейтральное сообщение'),
      createChecklistTask('Перевести лид в статус «недозвон»'),
      createChecklistTask('Настроить автоматическое касание через 7–14 дней'),
      createChecklistTask('Внести всю информацию в CRM'),
    ],
    incorrect: [],
  },
  [LeadStage.REJECTED1]: {
    correct: [
      createChecklistTask('Совершить 2-й звонок на следующий день'),
      createChecklistTask('Отправить повторно короткое сообщение в мессенджеры'),
      createChecklistTask('Предложить: «Напишите удобное время для звонка»'),
      createChecklistTask('Внести всю информацию в CRM'),
    ],
    incorrect: [],
  },
  [LeadStage.FIRST_CONTACT1]: {
    correct: [
      createChecklistTask('Отправить короткое сообщение в мессенджеры'),
      createChecklistTask('Предложить выбрать удобный формат связи'),
      createChecklistTask('Внести всю информацию в CRM'),
    ],
    incorrect: [],
  },
  [LeadStage.NEEDS_ANALYSIS]: {
    correct: [
      createChecklistTask('Проверить источник лида'),
      createChecklistTask('Ответить в течение 15 минут', [2, 5, 0, 0, 0, 0]),
      createChecklistTask('Представиться: кто вы, откуда, зачем пишете', [2, 5, 0, 0, 0, 0]),
      createChecklistTask('Уточнить удобный формат связи (звонок, WhatsApp, Telegram)'),
      createChecklistTask('Говорить персонализированно, обращаясь к клиенту по имени', [2, 5, 0, 0, 0, 5]),
      createChecklistTask('Задать 2–3 уточняющих вопроса', [2, 0, 0, 0, 2, 0]),
      createChecklistTask('Определить: клиент горячий / теплый / холодный', [0, 0, 0, 5, 5, 0]),
      createChecklistTask('Действовать последовательно, не перескакивать на другие этапы'),
      createChecklistTask('Внести всю информацию в CRM'),
    ],
    incorrect: [],
  },
  [LeadStage.PRESENTATION]: {
    correct: [
      createChecklistTask('Уточнить причину (неудобно? не в стране? занят?)'),
      createChecklistTask('Согласовать повторный созвон: день + час'),
      createChecklistTask('Отправить короткое подтверждение в мессенджере'),
      createChecklistTask('Поставить напоминание в CRM'),
      createChecklistTask('Отправить лёгкий прогрев: 1 объект, 1 статья, 1 факт'),
      createChecklistTask('Внести всю информацию в CRM'),
    ],
    incorrect: [],
  },
  [LeadStage.PROPOSAL]: {
    correct: [
      createChecklistTask('Уверенный голос, есть тезисы для разговора', [5, 5, 0, 2, 0, 0]),
      createChecklistTask('Короткая презентация: “Кто мы + чем отличаемся”', [0, 5, 0, 5, 0, 0]),
      createChecklistTask('Преимущества: технологии, база объектов, безопасность сделки', [2, 0, 25, 5, 0, 0]),
      createChecklistTask('Рассказать про коллективную закупку', [25, 0, 25, 25, 0, 25]),
      createChecklistTask('Показать 1–2 доказательства (отзывы, кейсы)', [25, 0, 0, 25, 0, 5]),
      createChecklistTask('Не перегружать фактами и рекламой', [5, 0, 0, 0, 0, 0]),
      createChecklistTask('Говорить про выгоды клиента, представлять аргументы', [0, 0, 0, 5, 5, 5]),
      createChecklistTask('Внести комментарии в CRM'),
    ],
    incorrect: [],
  },
  [LeadStage.NEGOTIATION]: {
    correct: [
      createChecklistTask('Не запугивать новостями и негативом', [0, 5, 0, 5, 0, 2]),
      createChecklistTask('Объяснить ключевые тренды рынка', [0, 25, 0, 5, 2, 2]),
      createChecklistTask('Рассказать о событиях, показывающих развитие рынка', [0, 25, 5, 5, 5, 5]),
      createChecklistTask('Показать конкретные прогнозы (цены, заполняемость, инвестиционный потенциал)', [5, 25, 0, 5, 2, 5]),
      createChecklistTask('Предоставлять факты, а не предположения “пальцем в небо”'),
      createChecklistTask('Показать свою экспертность'),
      createChecklistTask('Избегать обсуждения политических тем', [0, 2, 0, 0, 0, 0]),
      createChecklistTask('Пояснить риски и способы минимизации', [5, 0, 0, 0, 5, 5]),
      createChecklistTask('Спросить: “Как вам эта информация? Что важно уточнить?”', [0, 0, 0, 5, 5, 0]),
      createChecklistTask('Проверять, уточнять, все ли клиент понимает', [0, 0, 0, 0, 5, 0]),
      createChecklistTask('Внести комментарии в CRM'),
    ],
    incorrect: [],
  },
  [LeadStage.DECISION_MAKING]: {
    correct: [
      createChecklistTask('Какова цель: жить? сдавать? инвестировать? переезд?', [0, 0, 0, 0, 5, 0]),
      createChecklistTask('Задать все важные вопросы по выявлению потребностей', [0, 0, 0, 0, 5, 0]),
      createChecklistTask('Выяснить бюджет и валютность', [0, 0, 0, 0, 25, 0]),
      createChecklistTask('Сроки покупки', [0, 0, 0, 0, 5, 0]),
      createChecklistTask('Требования к району и типу недвижимости', [0, 0, 0, 0, 5, 0]),
      createChecklistTask('Важные детские, бытовые, профессиональные потребности'),
      createChecklistTask('Уточнить ограничения (ипотека, рассрочка, документы)', [0, 0, 5, 5, 25, 0]),
      createChecklistTask('Внести всю информацию в CRM'),
    ],
    incorrect: [],
  },
  [LeadStage.CONTRACT_SIGNING]: {
    correct: [
      createChecklistTask('Проверить: запрос клиента соответствует реалиям рынка?', [0, 0, 0, 0, 5, 0]),
      createChecklistTask('Показать примеры “как есть”, не бояться спугнуть клиента'),
      createChecklistTask('Показать аналогичные кейсы', [2, 25, 5, 25, 0, 5]),
      createChecklistTask('Аккуратно скорректировать ожидания (цены, сроки, районы)', [0, 0, 5, 0, 0, 0]),
      createChecklistTask('Согласовать финальный чек-лист объекта'),
      createChecklistTask('Согласовать финальный запрос клиента письменно'),
      createChecklistTask('Обсудили инвестиционные стратегии', [5, 5, 5, 2, 0, 5]),
      createChecklistTask('Внести всю информацию в CRM'),
    ],
    incorrect: [],
  },
  [LeadStage.ONBOARDING]: {
    correct: [
      createChecklistTask('Составить коммерческое предложение из 3–7 подходящих объектов', [2, 0, 2, 0, 0, 0]),
      createChecklistTask('Проверить объекты на соответствие запросу клиента'),
      createChecklistTask('Рассказать о плюсах и минусах каждого объекта', [2, 0, 5, 2, 0, 2]),
      createChecklistTask('Указать прогноз доходности (если это инвестиция)', [5, 5, 25, 5, 0, 2]),
      createChecklistTask('Добавить видеообзоры/карты/фото', [2, 2, 25, 5, 0, 5]),
      createChecklistTask('Отправить + голосовое объяснение'),
      createChecklistTask('Запросить обратную связь от клиента'),
      createChecklistTask('Внести комментарии в CRM'),
    ],
    incorrect: [],
  },
  [LeadStage.NEEDS_ANALYSIS1]: {
    correct: [
      createChecklistTask('Уточнить истинное возражение (дорого/не то место/не уверен)'),
      createChecklistTask('Переформулировать (“Правильно понимаю, что…” )'),
      createChecklistTask('Избегать споров и оправданий перед клиентом'),
      createChecklistTask('Дать решение (альтернативы, расчёты, выгоды), реальные факты', [5, 2, 0, 2, 25, 2]),
      createChecklistTask('Задавать уточняющие вопросы'),
      createChecklistTask('Подтвердить, что вопрос закрыт', [2, 0, 0, 2, 2, 0]),
      createChecklistTask('Спросить: “Тогда как движемся дальше?”'),
      createChecklistTask('Внести всю информацию в CRM'),
    ],
    incorrect: [],
  },
  [LeadStage.PRESENTATION1]: {
    correct: [
      createChecklistTask('Зафиксировать причину “позже”'),
      createChecklistTask('Определить срок (неделя, месяц, после зарплаты, после сезона)'),
      createChecklistTask('Настроить плавный прогрев'),
      createChecklistTask('1x в неделю — новостной дайджест'),
      createChecklistTask('1x в 2 недели — актуальные предложения'),
      createChecklistTask('1x в месяц — обзоры рынка', [0, 2, 0, 0, 0, 0]),
      createChecklistTask('Звонок раз в 30 дней'),
      createChecklistTask('Делать персональные подборки'),
      createChecklistTask('Внести комментарий в CRM'),
    ],
    incorrect: [],
  },
  [LeadStage.PROPOSAL1]: {
    correct: [
      createChecklistTask('Отправить серию автоматизированных материалов точечных, со смыслом', [2, 2, 5, 0, 0, 2]),
      createChecklistTask('Сравнение районов'),
      createChecklistTask('Выгоды инвестиций'),
      createChecklistTask('Реальные кейсы клиентов'),
      createChecklistTask('Закрытые предложения'),
      createChecklistTask('Коммуникация минимум 2 раза в неделю', [2, 0, 0, 0, 0, 2]),
      createChecklistTask('Ненавязчиво приглашать на показ'),
      createChecklistTask('Делать рассылку структурно и логично'),
      createChecklistTask('Избегать давление на клиента', [5, 0, 0, 0, 0, 5]),
      createChecklistTask('Отслеживать реакцию и вовлеченность клиента'),
      createChecklistTask('Внести всю информацию в CRM'),
    ],
    incorrect: [],
  },
  [LeadStage.NEGOTIATION1]: {
    correct: [
      createChecklistTask('Подтвердить встречу за 24 часа', [2, 0, 2, 0, 0, 0]),
      createChecklistTask('Сделать маршрут показа', [0, 0, 2, 0, 0, 0]),
      createChecklistTask('Согласовать доступ к объектам'),
      createChecklistTask('Отправить клиенту адреса/маршруты', [2, 0, 0, 0, 0, 0]),
      createChecklistTask('Хорошо знать историю и детали объектов', [5, 0, 2, 0, 0, 2]),
      createChecklistTask('Быть в диалоге с клиентом, говорить и получать обратную связь', [2, 0, 0, 0, 0, 5]),
      createChecklistTask('Задавать клиенту вопросы по ощущениям, чувствам', [2, 0, 0, 0, 0, 5]),
      createChecklistTask('Сделать акценты на “Почему именно этот объект”', [0, 0, 2, 5, 0, 0]),
      createChecklistTask('Сравнить объекты в конце'),
      createChecklistTask('Спросить: “Какой из этих вариантов вам ближе?”'),
      createChecklistTask('Внести комментарии в CRM'),
    ],
    incorrect: [],
  },
  [LeadStage.DECISION_MAKING1]: {
    correct: [
      createChecklistTask('Согласовать сумму задатка и условия заранее', [0, 0, 0, 0, 5, 0]),
      createChecklistTask('Согласовать способ внесения'),
      createChecklistTask('Подготовить документ (расписка/договор)'),
      createChecklistTask('Уведомить собственника'),
      createChecklistTask('Забронировать объект в системе'),
      createChecklistTask('Закрыть доступ другим риелторам'),
      createChecklistTask('Внести всю информацию в CRM (скан-копия)'),
    ],
    incorrect: [],
  },
  [LeadStage.CONTRACT_SIGNING1]: {
    correct: [
      createChecklistTask('Проверить документы собственника'),
      createChecklistTask('Проверить документы на объект'),
      createChecklistTask('Организовать встречу в нотариате'),
      createChecklistTask('Помочь клиенту с переводчиком при необходимости'),
      createChecklistTask('Контролировать процесс подписания'),
      createChecklistTask('Контролировать оплату'),
      createChecklistTask('Отправить закрывающие документы'),
      createChecklistTask('Организовать финальную коммуникацию с клиентом', [2, 0, 0, 0, 0, 0]),
      createChecklistTask('Внести всю информацию в CRM (скан-копия)'),
    ],
    incorrect: [],
  },
  [LeadStage.DEAL_CLOSED]: {
    correct: [
      createChecklistTask('Добавить в VIP-базу клиентов'),
      createChecklistTask('Позвонить или написать через 1–3 дня после сделки', [5, 0, 0, 0, 0, 5]),
      createChecklistTask('Спросить, всё ли удобно, получили ли ключи/документы', [0, 0, 0, 0, 0, 5]),
      createChecklistTask('Отправить полезный набор: контакты управляющей компании, чек-лист переезда', [5, 0, 5, 0, 0, 25]),
      createChecklistTask('Предложить помощь в продаже или аренде другой недвижимости (если нужно)', [5, 0, 0, 0, 0, 0]),
      createChecklistTask('Внести всю информацию в CRM'),
    ],
    incorrect: [],
  },
  [LeadStage.POST_PURCHASE_FOLLOWUP]: {
    correct: [
      createChecklistTask('Звонок/сообщение: «Как вам квартира? Как проходит обживание?»', [2, 0, 0, 0, 0, 5]),
      createChecklistTask('Уточнить, были ли сложности (ТСЖ, ремонт, коммуникации)', [2, 0, 0, 0, 0, 5]),
      createChecklistTask('При необходимости — помочь контактом специалиста или советом'),
      createChecklistTask('Спросить, какие дальнейшие планы по недвижимости (инвестиции, расширение)', [0, 0, 0, 0, 5, 0]),
      createChecklistTask('Внести всю информацию в CRM'),
    ],
    incorrect: [],
  },
  [LeadStage.SATISFACTION_CHECK]: {
    correct: [
      createChecklistTask('Если у вас есть знакомые, кому нужна помощь в покупке недвижимости'),
      createChecklistTask('Предложить понятный бонус (% от сделки, подарок, сервис)'),
      createChecklistTask('Спросить прямо: «Есть ли кто-то, кому актуально прямо сейчас?»'),
      createChecklistTask('Зафиксировать переданные контакты в CRM'),
      createChecklistTask('Отправить клиенту персональную реферальную ссылку/визитку'),
      createChecklistTask('Внести всю информацию в CRM'),
    ],
    incorrect: [],
  },
  [LeadStage.UPSELL_OPPORTUNITY]: {
    correct: [
      createChecklistTask('Сделать касание через 3–6 месяцев (звонок или мессенджер)', [0, 0, 0, 0, 0, 2]),
      createChecklistTask('Узнать планы'),
      createChecklistTask('Предложить бесплатную консультацию по рынку', [2, 0, 0, 0, 0, 2]),
      createChecklistTask('Записать новую потребность в CRM'),
    ],
    incorrect: [],
  },
  [LeadStage.REGISTERED]: { correct: [], incorrect: [] },
  [LeadStage.ADAPTED]: { correct: [], incorrect: [] },
  // NETWORK этапы - Отказ
  [LeadStage.NETWORK_REJECTED_DEFECTIVE]: { correct: [], incorrect: [] },
  [LeadStage.NETWORK_REJECTED]: { correct: [], incorrect: [] },
  [LeadStage.NETWORK_NO_CALL_3]: { correct: [], incorrect: [] },
  [LeadStage.NETWORK_NO_CALL_2]: { correct: [], incorrect: [] },
  [LeadStage.NETWORK_NO_CALL_1]: { correct: [], incorrect: [] },
  // NETWORK этапы - В работе
  [LeadStage.NETWORK_NEW_LEAD]: { correct: [], incorrect: [] },
  [LeadStage.NETWORK_CALL_LATER]: { correct: [], incorrect: [] },
  [LeadStage.NETWORK_COMPANY_PRESENTED]: { correct: [], incorrect: [] },
  [LeadStage.NETWORK_PLATFORM_PRESENTED]: { correct: [], incorrect: [] },
  [LeadStage.NETWORK_OFFER_GIVEN]: { correct: [], incorrect: [] },
  [LeadStage.NETWORK_OBJECTIONS]: { correct: [], incorrect: [] },
  [LeadStage.NETWORK_DEFERRED_DEMAND]: { correct: [], incorrect: [] },
  [LeadStage.NETWORK_AGREEMENT]: { correct: [], incorrect: [] },
  [LeadStage.NETWORK_FORM_FILLED]: { correct: [], incorrect: [] },
  [LeadStage.NETWORK_ACCOUNT_REGISTERED]: { correct: [], incorrect: [] },
  [LeadStage.NETWORK_OFFER_SIGNED]: { correct: [], incorrect: [] },
  [LeadStage.NETWORK_WORK_STARTED]: { correct: [], incorrect: [] },
  // NETWORK этапы - Риелтор
  [LeadStage.REALTOR_1]: { correct: [], incorrect: [] },
  [LeadStage.REALTOR_2]: { correct: [], incorrect: [] },
  [LeadStage.REALTOR_3]: { correct: [], incorrect: [] },
  [LeadStage.REALTOR_4]: { correct: [], incorrect: [] },
  [LeadStage.REALTOR_5]: { correct: [], incorrect: [] },
  [LeadStage.REALTOR_6]: { correct: [], incorrect: [] },
  // NETWORK этапы - Куратор
  [LeadStage.CURATOR_1]: { correct: [], incorrect: [] },
  [LeadStage.CURATOR_2]: { correct: [], incorrect: [] },
  [LeadStage.CURATOR_3]: { correct: [], incorrect: [] },
  [LeadStage.CURATOR_4]: { correct: [], incorrect: [] },
  [LeadStage.CURATOR_5]: { correct: [], incorrect: [] },
  [LeadStage.CURATOR_6]: { correct: [], incorrect: [] },
  // OWNER / AGENT этапы (пустые для RP)
  [LeadStage.OWNER_REJECTED_DEFECTIVE]: { correct: [], incorrect: [] },
  [LeadStage.OWNER_REJECTED_OWNER]: { correct: [], incorrect: [] },
  [LeadStage.OWNER_NO_CALL_3]: { correct: [], incorrect: [] },
  [LeadStage.OWNER_NO_CALL_2]: { correct: [], incorrect: [] },
  [LeadStage.OWNER_NO_CALL_1]: { correct: [], incorrect: [] },
  [LeadStage.OWNER_NEW_OWNER]: { correct: [], incorrect: [] },
  [LeadStage.OWNER_CALL_LATER]: { correct: [], incorrect: [] },
  [LeadStage.OWNER_COMPANY_PRESENTED]: { correct: [], incorrect: [] },
  [LeadStage.OWNER_OBJECT_DISCUSSED]: { correct: [], incorrect: [] },
  [LeadStage.OWNER_PHOTO_PROPOSED]: { correct: [], incorrect: [] },
  [LeadStage.OWNER_EXCLUSIVE_PROPOSED]: { correct: [], incorrect: [] },
  [LeadStage.OWNER_OBJECTIONS]: { correct: [], incorrect: [] },
  [LeadStage.OWNER_AGREED]: { correct: [], incorrect: [] },
  [LeadStage.OWNER_ACTIVE_FOR_SALE]: { correct: [], incorrect: [] },
  [LeadStage.OWNER_GET_REFERRAL]: { correct: [], incorrect: [] },
  [LeadStage.OWNER_NEW_OBJECT_INQUIRY]: { correct: [], incorrect: [] },
  [LeadStage.AGENT_REJECTED_DEFECTIVE]: { correct: [], incorrect: [] },
  [LeadStage.AGENT_REJECTED]: { correct: [], incorrect: [] },
  [LeadStage.AGENT_NO_CALL_3]: { correct: [], incorrect: [] },
  [LeadStage.AGENT_NO_CALL_2]: { correct: [], incorrect: [] },
  [LeadStage.AGENT_NO_CALL_1]: { correct: [], incorrect: [] },
  [LeadStage.AGENT_NEW_AGENT]: { correct: [], incorrect: [] },
  [LeadStage.AGENT_CALL_LATER]: { correct: [], incorrect: [] },
  [LeadStage.AGENT_COMPANY_PRESENTED]: { correct: [], incorrect: [] },
  [LeadStage.AGENT_FORMAT]: { correct: [], incorrect: [] },
  [LeadStage.AGENT_OBJECTIONS]: { correct: [], incorrect: [] },
  [LeadStage.AGENT_AGREED]: { correct: [], incorrect: [] },
  [LeadStage.AGENT_ACTIVE]: { correct: [], incorrect: [] },
};

// Данные чеклиста для каждого этапа воронки СЕТИ
const checklistDataNetwork: Record<LeadStage, ChecklistItem> = {
  // SALES этапы - пустые для NETWORK
  [LeadStage.REJECTED]: { correct: [], incorrect: [] },
  [LeadStage.FIRST_CONTACT]: { correct: [], incorrect: [] },
  [LeadStage.QUALIFICATION]: { correct: [], incorrect: [] },
  [LeadStage.REJECTED1]: { correct: [], incorrect: [] },
  [LeadStage.FIRST_CONTACT1]: { correct: [], incorrect: [] },
  [LeadStage.NEEDS_ANALYSIS]: { correct: [], incorrect: [] },
  [LeadStage.PRESENTATION]: { correct: [], incorrect: [] },
  [LeadStage.PROPOSAL]: { correct: [], incorrect: [] },
  [LeadStage.NEGOTIATION]: { correct: [], incorrect: [] },
  [LeadStage.DECISION_MAKING]: { correct: [], incorrect: [] },
  [LeadStage.CONTRACT_SIGNING]: { correct: [], incorrect: [] },
  [LeadStage.ONBOARDING]: { correct: [], incorrect: [] },
  [LeadStage.NEEDS_ANALYSIS1]: { correct: [], incorrect: [] },
  [LeadStage.PRESENTATION1]: { correct: [], incorrect: [] },
  [LeadStage.PROPOSAL1]: { correct: [], incorrect: [] },
  [LeadStage.NEGOTIATION1]: { correct: [], incorrect: [] },
  [LeadStage.DECISION_MAKING1]: { correct: [], incorrect: [] },
  [LeadStage.CONTRACT_SIGNING1]: { correct: [], incorrect: [] },
  [LeadStage.DEAL_CLOSED]: { correct: [], incorrect: [] },
  [LeadStage.POST_PURCHASE_FOLLOWUP]: { correct: [], incorrect: [] },
  [LeadStage.SATISFACTION_CHECK]: { correct: [], incorrect: [] },
  [LeadStage.UPSELL_OPPORTUNITY]: { correct: [], incorrect: [] },
  [LeadStage.REGISTERED]: { correct: [], incorrect: [] },
  [LeadStage.ADAPTED]: { correct: [], incorrect: [] },
  // NETWORK этапы - Отказ
  [LeadStage.NETWORK_REJECTED_DEFECTIVE]: {
    correct: [
      createChecklistTask('Проверить корректность телефона, e-mail, имени, запроса', [0, 0, 0, 0, 0, 0]),
      createChecklistTask('Отметить причину брака в CRM (не существует номер/ошибка/спам/бот)', [0, 0, 0, 0, 0, 0]),
      createChecklistTask('Внести информацию в CRM о результатах на этом этапе', [0, 0, 0, 0, 0, 0]),
    ],
    incorrect: [],
  },
  [LeadStage.NETWORK_REJECTED]: {
    correct: [
      createChecklistTask('Уточнить причину отказа', [0, 0, 0, 0, 0, 0]),
      createChecklistTask('Переформулировать и проверить понимание', [0, 0, 0, 0, 0, 0]),
      createChecklistTask('Внести информацию в CRM о результатах на этом этапе', [0, 0, 0, 0, 0, 0]),
    ],
    incorrect: [],
  },
  [LeadStage.NETWORK_NO_CALL_3]: {
    correct: [
      createChecklistTask('Совершить 3-й звонок на следующий день', [0, 0, 0, 0, 0, 0]),
      createChecklistTask('Отправить финальное нейтральное сообщение', [2, 0, 0, 0, 0, 0]),
      createChecklistTask('Внести информацию в CRM о результатах на этом этапе', [0, 0, 0, 0, 0, 0]),
    ],
    incorrect: [],
  },
  [LeadStage.NETWORK_NO_CALL_2]: {
    correct: [
      createChecklistTask('Совершить 2-й звонок на следующий день', [0, 0, 0, 0, 0, 0]),
      createChecklistTask('Отправить повторно короткое сообщение в мессенджеры', [0, 0, 0, 0, 0, 0]),
      createChecklistTask('Предложить: «Напишите удобное время для звонка»', [2, 0, 0, 0, 0, 2]),
      createChecklistTask('Внести информацию в CRM о результатах на этом этапе', [0, 0, 0, 0, 0, 0]),
    ],
    incorrect: [],
  },
  [LeadStage.NETWORK_NO_CALL_1]: {
    correct: [
      createChecklistTask('Отправить короткое сообщение в мессенджеры', [0, 0, 0, 0, 0, 0]),
      createChecklistTask('Предложить выбрать удобный формат связи', [2, 0, 0, 0, 0, 2]),
      createChecklistTask('Внести информацию в CRM о результатах на этом этапе', [0, 0, 0, 0, 0, 0]),
    ],
    incorrect: [],
  },
  // NETWORK этапы - В работе
  [LeadStage.NETWORK_NEW_LEAD]: {
    correct: [
      createChecklistTask('Ответить в течение 15 минут', [2, 2, 0, 0, 0, 0]),
      createChecklistTask('Представиться: кто вы, откуда, зачем пишете', [2, 5, 0, 0, 0, 0]),
      createChecklistTask('Уточнить удобный формат связи (звонок, WhatsApp, Telegram)', [0, 0, 0, 0, 0, 0]),
      createChecklistTask('Говорить персонализированно, обращаться к рефералу по имени', [2, 5, 0, 0, 0, 5]),
      createChecklistTask('Внести информацию в CRM о результатах на этом этапе', [0, 0, 0, 0, 0, 0]),
    ],
    incorrect: [],
  },
  [LeadStage.NETWORK_CALL_LATER]: {
    correct: [
      createChecklistTask('Уточнить причину (неудобно? не в стране? занят?)', [2, 0, 0, 0, 0, 2]),
      createChecklistTask('Согласовать повторный созвон: день + час', [0, 0, 0, 0, 0, 2]),
      createChecklistTask('Отправить короткое подтверждение в мессенджере', [0, 0, 0, 0, 0, 0]),
      createChecklistTask('Поставить напоминание в CRM', [0, 0, 0, 0, 0, 0]),
      createChecklistTask('Внести информацию в CRM о результатах на этом этапе', [0, 0, 0, 0, 0, 0]),
    ],
    incorrect: [],
  },
  [LeadStage.NETWORK_COMPANY_PRESENTED]: {
    correct: [
      createChecklistTask('Уверенный голос, есть тезисы для разговора', [5, 5, 0, 2, 0, 5]),
      createChecklistTask('Короткая презентация: "Кто мы + чем отличаемся"', [2, 5, 10, 10, 5, 2]),
      createChecklistTask('Преимущества портала: аналитика, функционал', [0, 2, 10, 10, 5, 2]),
      createChecklistTask('Рассказать про базу объектов', [0, 0, 2, 5, 2, 2]),
      createChecklistTask('Рассказать про свою CRM', [2, 0, 2, 25, 5, 2]),
      createChecklistTask('Рассказать про свою MLM', [2, 2, 25, 5, 25, 2]),
      createChecklistTask('Говорить про выгоды реферала, представлять аргументы', [0, 0, 0, 5, 25, 2]),
      createChecklistTask('Внести информацию в CRM о результатах на этом этапе', [0, 0, 0, 0, 0, 0]),
    ],
    incorrect: [],
  },
  [LeadStage.NETWORK_PLATFORM_PRESENTED]: {
    correct: [
      createChecklistTask('Продемонстрировать функциональность платформы', [2, 5, 2, 5, 10, 2]),
      createChecklistTask('Показать преимущества аналитических функций платформы', [2, 2, 5, 5, 5, 0]),
      createChecklistTask('Продемонстрировать уникальные опции платформы', [2, 2, 10, 5, 5, 2]),
      createChecklistTask('Продемонстрировать работу CRM', [2, 2, 10, 5, 0, 2]),
      createChecklistTask('Продемонстрировать принцип работы MLM', [2, 2, 10, 5, 0, 2]),
      createChecklistTask('Показать, как реферал сможет экономить время и деньги', [2, 25, 10, 5, 5, 5]),
      createChecklistTask('Мнение: "Как вам эта информация? Что важно уточнить?"', [5, 25, 5, 5, 2, 5]),
      createChecklistTask('Проверять, уточнять, все ли реферал понимает', [5, 2, 0, 0, 0, 0]),
      createChecklistTask('Пояснить риски и способы минимизации', [5, 0, 0, 0, 5, 5]),
      createChecklistTask('Внести информацию в CRM о результатах на этом этапе', [0, 0, 0, 5, 5, 5]),
    ],
    incorrect: [],
  },
  [LeadStage.NETWORK_OFFER_GIVEN]: {
    correct: [
      createChecklistTask('Объяснить, что входит в предложение', [2, 0, 0, 0, 5, 2]),
      createChecklistTask('Подчеркнуть выгоды', [0, 2, 2, 2, 5, 2]),
      createChecklistTask('Ответить на вопросы', [5, 2, 2, 2, 10, 2]),
      createChecklistTask('Уточнить готовность переходить к анкете', [0, 0, 0, 0, 0, 0]),
      createChecklistTask('Отправить оффер в удобном формате', [0, 2, 0, 0, 2, 2]),
      createChecklistTask('Внести информацию в CRM о результатах на этом этапе', [0, 0, 0, 0, 0, 0]),
    ],
    incorrect: [],
  },
  [LeadStage.NETWORK_OBJECTIONS]: {
    correct: [
      createChecklistTask('Уточнить истинное возражение', [0, 0, 0, 2, 5, 0]),
      createChecklistTask('Избегать споров и оправданий перед рефералом', [2, 0, 5, 10, 0, 5]),
      createChecklistTask('Дать решение, выгоды, привести реальные факты', [2, 0, 5, 10, 0, 2]),
      createChecklistTask('Переформулировать для проверки понимания', [2, 2, 5, 5, 2, 5]),
      createChecklistTask('Внести информацию в CRM о результатах на этом этапе', [0, 0, 0, 0, 0, 0]),
    ],
    incorrect: [],
  },
  [LeadStage.NETWORK_DEFERRED_DEMAND]: {
    correct: [
      createChecklistTask('Зафиксировать причину "позже"', [0, 0, 0, 0, 0, 0]),
      createChecklistTask('Определить срок (неделя, месяц)', [0, 0, 0, 0, 0, 0]),
      createChecklistTask('Настроить плавный прогрев:', [0, 0, 0, 0, 0, 0]),
      createChecklistTask('1x в неделю — новостной дайджест', [0, 0, 0, 0, 0, 0]),
      createChecklistTask('1x в 2 недели — интерес "Как дела? Как поживаешь?"', [0, 0, 0, 0, 0, 2]),
      createChecklistTask('1x в месяц — новости, кейсы других рефералов', [0, 2, 0, 0, 0, 2]),
      createChecklistTask('Звонок раз в 30 дней', [2, 2, 0, 0, 2, 2]),
      createChecklistTask('Делать персональные подборки', [0, 0, 0, 0, 0, 0]),
      createChecklistTask('Внести информацию в CRM о результатах на этом этапе', [0, 0, 0, 0, 0, 0]),
    ],
    incorrect: [],
  },
  [LeadStage.NETWORK_AGREEMENT]: {
    correct: [
      createChecklistTask('Пригласить «Давайте перейдем к оформлению?»', [2, 2, 5, 0, 0, 2]),
      createChecklistTask('Подтвердить финальные условия', [2, 0, 2, 0, 5, 0]),
      createChecklistTask('Избегать излишнего давление на реферала', [5, 5, 5, 5, 5, 10]),
      createChecklistTask('Внести информацию в CRM о результатах на этом этапе', [0, 0, 0, 0, 0, 0]),
    ],
    incorrect: [],
  },
  [LeadStage.NETWORK_FORM_FILLED]: {
    correct: [
      createChecklistTask('Проверить корректность заполненной анкеты', [2, 0, 2, 0, 0, 0]),
      createChecklistTask('Уточнить отсутствующие данные', [2, 0, 2, 0, 0, 0]),
      createChecklistTask('Сохранить необходимые данные о реферале в своем личном кабинете', [0, 0, 0, 0, 0, 0]),
      createChecklistTask('Отправить рефералу инструкцию по регистрации в личном кабинете', [2, 0, 0, 0, 0, 0]),
      createChecklistTask('Внести информацию в CRM о результатах на этом этапе', [5, 0, 2, 0, 0, 2]),
    ],
    incorrect: [],
  },
  [LeadStage.NETWORK_ACCOUNT_REGISTERED]: {
    correct: [
      createChecklistTask('Зарегистрировать реферала в системе', [2, 0, 0, 0, 5, 0]),
      createChecklistTask('Предоставить мини-инструкцию по личному кабинету', [2, 0, 0, 0, 0, 2]),
      createChecklistTask('Убедиться, что реферал ориентируется в функционале', [2, 2, 5, 2, 0, 2]),
      createChecklistTask('Внести информацию в CRM о результатах на этом этапе', [0, 0, 0, 0, 0, 0]),
    ],
    incorrect: [],
  },
  [LeadStage.NETWORK_OFFER_SIGNED]: {
    correct: [
      createChecklistTask('Реферал подписывает оферту на портале', [5,2,5,5,5,2]),
      createChecklistTask('Ответить на возникающие вопросы', [2,2,0,2,2,2]),
      createChecklistTask('Внести информацию в CRM о результатах на этом этапе', [0, 0, 0, 0, 0, 0]),
    ],
    incorrect: [],
  },
  [LeadStage.NETWORK_WORK_STARTED]: {
    correct: [
      createChecklistTask('Направить рефералу приветственное сообщение/пакет материалов', [5, 0, 0, 0, 0, 0]),
      createChecklistTask('Добавить в рабочие чаты', [5, 0, 0, 5, 0, 2]),
      createChecklistTask('Договориться о первом рабочем шаге', [5, 0, 0, 0, 0, 2]),
      createChecklistTask('Уточнить удобный формат взаимодействия', [5, 0, 5, 0, 0, 5]),
      createChecklistTask('Внести реферала в рабочий план', [5, 0, 0, 0, 0, 2]),
      createChecklistTask('Внести всю информацию в CRM', [0, 0, 0, 0, 0, 0]),
      createChecklistTask('Вручение и пояснение плана по адаптации', [2, 0, 0, 0, 0, 2]),
      createChecklistTask('Собрать обратную связь от реферала: мысли и впечатления от проекта', [10, 0, 0, 0, 0, 10]),
      createChecklistTask('Получить обратную связь от реферала - чего ему не хватает?', [5, 0, 0, 0, 0, 10]),
      createChecklistTask('Запрос "Дайте обратную связь по работе со мной"', [10, 0, 0, 0, 0, 10]),
      createChecklistTask('Внести информацию в CRM о результатах на этом этапе', [0, 0, 0, 0, 0, 0]),
      createChecklistTask('Настройка трекинга реферала', [0, 0, 0, 0, 0, 0]),
    ],
    incorrect: [],
  },
  // NETWORK этапы - Риелтор
  [LeadStage.REALTOR_1]: { correct: [], incorrect: [] },
  [LeadStage.REALTOR_2]: { correct: [], incorrect: [] },
  [LeadStage.REALTOR_3]: { correct: [], incorrect: [] },
  [LeadStage.REALTOR_4]: { correct: [], incorrect: [] },
  [LeadStage.REALTOR_5]: { correct: [], incorrect: [] },
  [LeadStage.REALTOR_6]: { correct: [], incorrect: [] },
  // NETWORK этапы - Куратор
  [LeadStage.CURATOR_1]: { correct: [], incorrect: [] },
  [LeadStage.CURATOR_2]: { correct: [], incorrect: [] },
  [LeadStage.CURATOR_3]: { correct: [], incorrect: [] },
  [LeadStage.CURATOR_4]: { correct: [], incorrect: [] },
  [LeadStage.CURATOR_5]: { correct: [], incorrect: [] },
  [LeadStage.CURATOR_6]: { correct: [], incorrect: [] },
  // OWNER / AGENT этапы (пустые для NETWORK)
  [LeadStage.OWNER_REJECTED_DEFECTIVE]: { correct: [], incorrect: [] },
  [LeadStage.OWNER_REJECTED_OWNER]: { correct: [], incorrect: [] },
  [LeadStage.OWNER_NO_CALL_3]: { correct: [], incorrect: [] },
  [LeadStage.OWNER_NO_CALL_2]: { correct: [], incorrect: [] },
  [LeadStage.OWNER_NO_CALL_1]: { correct: [], incorrect: [] },
  [LeadStage.OWNER_NEW_OWNER]: { correct: [], incorrect: [] },
  [LeadStage.OWNER_CALL_LATER]: { correct: [], incorrect: [] },
  [LeadStage.OWNER_COMPANY_PRESENTED]: { correct: [], incorrect: [] },
  [LeadStage.OWNER_OBJECT_DISCUSSED]: { correct: [], incorrect: [] },
  [LeadStage.OWNER_PHOTO_PROPOSED]: { correct: [], incorrect: [] },
  [LeadStage.OWNER_EXCLUSIVE_PROPOSED]: { correct: [], incorrect: [] },
  [LeadStage.OWNER_OBJECTIONS]: { correct: [], incorrect: [] },
  [LeadStage.OWNER_AGREED]: { correct: [], incorrect: [] },
  [LeadStage.OWNER_ACTIVE_FOR_SALE]: { correct: [], incorrect: [] },
  [LeadStage.OWNER_GET_REFERRAL]: { correct: [], incorrect: [] },
  [LeadStage.OWNER_NEW_OBJECT_INQUIRY]: { correct: [], incorrect: [] },
  [LeadStage.AGENT_REJECTED_DEFECTIVE]: { correct: [], incorrect: [] },
  [LeadStage.AGENT_REJECTED]: { correct: [], incorrect: [] },
  [LeadStage.AGENT_NO_CALL_3]: { correct: [], incorrect: [] },
  [LeadStage.AGENT_NO_CALL_2]: { correct: [], incorrect: [] },
  [LeadStage.AGENT_NO_CALL_1]: { correct: [], incorrect: [] },
  [LeadStage.AGENT_NEW_AGENT]: { correct: [], incorrect: [] },
  [LeadStage.AGENT_CALL_LATER]: { correct: [], incorrect: [] },
  [LeadStage.AGENT_COMPANY_PRESENTED]: { correct: [], incorrect: [] },
  [LeadStage.AGENT_FORMAT]: { correct: [], incorrect: [] },
  [LeadStage.AGENT_OBJECTIONS]: { correct: [], incorrect: [] },
  [LeadStage.AGENT_AGREED]: { correct: [], incorrect: [] },
  [LeadStage.AGENT_ACTIVE]: { correct: [], incorrect: [] },
};

export const getChecklistTotal = (stage: LeadStage, productType?: ProductType): number => {
  const data = productType === ProductType.NETWORK ? checklistDataNetwork : checklistData;
  return data[stage]?.correct.length || 0;
};

const allChecklistTasks: Array<{ stage: LeadStage; index: number; task: ChecklistTask }> = Object.entries(
  checklistData
).flatMap(([stageKey, entry]) =>
  entry.correct.map((task, index) => ({
    stage: stageKey as LeadStage,
    index,
    task,
  }))
);

const allChecklistTasksNetwork: Array<{ stage: LeadStage; index: number; task: ChecklistTask }> = Object.entries(
  checklistDataNetwork
).flatMap(([stageKey, entry]) =>
  entry.correct.map((task, index) => ({
    stage: stageKey as LeadStage,
    index,
    task,
  }))
);

const trustIndicators = [
  'Доверие к риелтору',
  'Доверие к стране',
  'Доверие к застройщику',
  'Осознание потребности в сделке',
  'Наличие ресурсов для сделки',
  'Позитивные эмоции',
];

const trustIndicatorsNetwork = [
  'Доверие к куратору',
  'Доверие к зарубежной недвижимости',
  'Доверие к MLM технологиям',
  'Осознание потребности в обучении',
  'Потребность в изменениях',
  'Эмоции',
];

const LeadStageChecklist: React.FC<LeadStageChecklistProps> = ({
  leadId,
  leadName,
  stage,
  productType,
  onCommentSaved,
  onCloseChecklist: _onCloseChecklist,
}) => {
  const { showToast, ToastContainer } = useToast();
  const { t } = useI18n();

  const formatMessage = (template: string, values: Record<string, string | number>) =>
    Object.entries(values).reduce((message, [key, value]) => message.replace(`{${key}}`, String(value)), template);
  // Состояние для переключения типа библиотеки (Сеть/Продажи)
  const [selectedLibraryProductType, setSelectedLibraryProductType] = useState<ProductType>(
    productType || ProductType.SALES
  );
  
  // Синхронизация с пропсом productType при его изменении
  useEffect(() => {
    if (productType) {
      setSelectedLibraryProductType(productType);
    }
  }, [productType]);
  
  // Выбираем правильные данные в зависимости от типа продукта
  const isNetwork = productType === ProductType.NETWORK;
  const currentChecklistData = React.useMemo(() => 
    isNetwork ? checklistDataNetwork : checklistData,
    [isNetwork]
  );
  const currentTrustIndicators = React.useMemo(() => 
    isNetwork ? trustIndicatorsNetwork : trustIndicators,
    [isNetwork]
  );
  const currentAllChecklistTasks = React.useMemo(() => 
    isNetwork ? allChecklistTasksNetwork : allChecklistTasks,
    [isNetwork]
  );
  
  const stageChecklist = currentChecklistData[stage] || { correct: [], incorrect: [] };
  
  
  const [quickNoteText, setQuickNoteText] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  
  // Состояния для модалки файлов
  const [isFilesModalOpen, setIsFilesModalOpen] = useState(false);
  const [files, setFiles] = useState<Array<{ filename: string; originalName: string; mimeType: string; size: number; url: string }>>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Состояния для базовых файлов
  const [baseFiles, setBaseFiles] = useState<Array<LeadFile & { _id?: string }>>([]);
  const [selectedBaseFiles, setSelectedBaseFiles] = useState<Set<string>>(new Set());
  const [isLoadingBaseFiles, setIsLoadingBaseFiles] = useState(false);
  const [isAttachingBaseFiles, setIsAttachingBaseFiles] = useState(false);
  const [filesCategory, setFilesCategory] = useState<'common' | 'personal' | 'library'>('common');
  
  // Состояния для библиотеки риелтора
  const [libraryFiles, setLibraryFiles] = useState<Array<LeadFile & { _id?: string }>>([]);
  const [libraryFolders, setLibraryFolders] = useState<LibraryFolder[]>([]);
  const [selectedLibraryFiles, setSelectedLibraryFiles] = useState<Set<string>>(new Set());
  const [isLoadingLibraryFiles, setIsLoadingLibraryFiles] = useState(false);
  const [isUploadingLibraryFiles, setIsUploadingLibraryFiles] = useState(false);
  const [isAttachingLibraryFiles, setIsAttachingLibraryFiles] = useState(false);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [currentFolderName, setCurrentFolderName] = useState<string | null>(null);
  const [folderPath, setFolderPath] = useState<LibraryFolder[]>([]);
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [showCreateFolderInput, setShowCreateFolderInput] = useState(false);
  const [deletingFolderId, setDeletingFolderId] = useState<string | null>(null);
  const [deleteFolderConfirm, setDeleteFolderConfirm] = useState<{ isOpen: boolean; folder: LibraryFolder | null }>({ isOpen: false, folder: null });
  const [deleteLeadFileConfirm, setDeleteLeadFileConfirm] = useState<{ isOpen: boolean; filename: string | null; originalName?: string }>({ isOpen: false, filename: null });
  const libraryFileInputRef = useRef<HTMLInputElement>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingChangesRef = useRef<Array<{ stage: LeadStage; index: number; checked: boolean }>>([]);

  const getStorageKey = (stageValue: LeadStage, index: number) => {
    return `checklist_${leadId}_${stageValue}_${index}`;
  };

  // Инициализация из localStorage (fallback для обратной совместимости)
  const initializeCheckedItemsFromLocalStorage = useCallback(() => {
    const saved: Record<string, boolean> = {};
    currentAllChecklistTasks.forEach(({ stage: taskStage, index }) => {
      const key = getStorageKey(taskStage, index);
      if (localStorage.getItem(key) === 'true') {
        saved[key] = true;
      }
    });
    return saved;
  }, [currentAllChecklistTasks, leadId]);

  // Инициализация из localStorage
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>(() => {
    const saved: Record<string, boolean> = {};
    // Используем правильные данные в зависимости от типа продукта
    const tasks = isNetwork ? allChecklistTasksNetwork : allChecklistTasks;
    tasks.forEach(({ stage: taskStage, index }) => {
      const key = getStorageKey(taskStage, index);
      if (localStorage.getItem(key) === 'true') {
        saved[key] = true;
      }
    });
    return saved;
  });

  // Загрузка состояния чек-листа с бэкенда
  useEffect(() => {
    const loadChecklistState = async () => {
      try {
        const response = await leadCrmService.getChecklistState(leadId);
        if (response.success && response.data) {
          const saved: Record<string, boolean> = {};
          response.data.items.forEach(item => {
            const key = getStorageKey(item.stage, item.index);
            if (item.checked) {
              saved[key] = true;
              // Синхронизируем с localStorage для обратной совместимости
              localStorage.setItem(key, 'true');
            } else {
              // Удаляем из localStorage если не отмечено
              localStorage.removeItem(key);
            }
          });
          setCheckedItems(saved);
          // Откладываем событие до следующего тика, чтобы избежать обновления во время рендеринга
          setTimeout(() => {
            window.dispatchEvent(new Event('checklistUpdated'));
          }, 0);
        } else {
          // Если не удалось загрузить с бэкенда, используем localStorage
          console.warn('Failed to load checklist from backend, using localStorage:', response.message);
          setCheckedItems(initializeCheckedItemsFromLocalStorage());
        }
      } catch (error) {
        console.error('Error loading checklist state:', error);
        // Fallback на localStorage
        setCheckedItems(initializeCheckedItemsFromLocalStorage());
      }
    };

    loadChecklistState();
  }, [leadId, initializeCheckedItemsFromLocalStorage]);

  // Сохранение изменений на бэкенд с debounce
  const saveChecklistToBackend = useCallback(async (changes: Array<{ stage: LeadStage; index: number; checked: boolean }>) => {
    if (changes.length === 0) return;

    try {
      const response = await leadCrmService.saveChecklistState(leadId, changes);
      if (response.success && response.data) {
      } else {
        console.error('Failed to save checklist to backend:', response.message);
      }
    } catch (error) {
      console.error('Error saving checklist to backend:', error);
    }
  }, [leadId]);

  const handleCheckboxChange = (stageValue: LeadStage, index: number, checked: boolean) => {
    const key = getStorageKey(stageValue, index);
    setCheckedItems((prev) => {
      const newState = { ...prev, [key]: checked };
      
      // Сохраняем в localStorage для обратной совместимости
      if (checked) {
        localStorage.setItem(key, 'true');
      } else {
        localStorage.removeItem(key);
      }
      
      // Добавляем изменение в очередь для сохранения на бэкенд
      pendingChangesRef.current.push({ stage: stageValue, index, checked });
      
      // Очищаем предыдущий таймер
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      
      // Сохраняем на бэкенд с задержкой 500ms (debounce)
      saveTimeoutRef.current = setTimeout(() => {
        const changesToSave = [...pendingChangesRef.current];
        pendingChangesRef.current = [];
        saveChecklistToBackend(changesToSave);
      }, 500);
      
      // Откладываем событие до следующего тика, чтобы избежать обновления во время рендеринга
      setTimeout(() => {
        window.dispatchEvent(new Event('checklistUpdated'));
      }, 0);
      return newState;
    });
  };

  // Очистка таймера при размонтировании
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      // Сохраняем оставшиеся изменения перед размонтированием
      if (pendingChangesRef.current.length > 0) {
        saveChecklistToBackend(pendingChangesRef.current);
      }
    };
  }, [saveChecklistToBackend]);

  // Функции для работы с файлами лида
  const loadLeadFiles = useCallback(async () => {
    if (!leadId) {
      setFiles([]);
      return;
    }
    
    try {
      const response = await leadCrmService.getLeadFiles(leadId);
      if (response.success && response.data) {
        setFiles(response.data.files);
      }
    } catch (error) {
      console.error('Failed to load lead files:', error);
      setFiles([]);
    }
  }, [leadId]);

  // Загрузка базовых файлов
  const loadBaseFiles = useCallback(async () => {
    setIsLoadingBaseFiles(true);
    try {
      const response = await libraryCrmService.getBaseFiles(selectedLibraryProductType);
      if (response.success && response.data) {
        setBaseFiles(response.data.files);
      } else {
        console.error('Failed to load base files:', response.message);
        setBaseFiles([]);
      }
    } catch (error) {
      console.error('Failed to load base files:', error);
      setBaseFiles([]);
    } finally {
      setIsLoadingBaseFiles(false);
    }
  }, [selectedLibraryProductType]);

  // Привязка выбранных базовых файлов к лиду
  const handleAttachBaseFiles = useCallback(async () => {
    if (!leadId || selectedBaseFiles.size === 0) return;

    setIsAttachingBaseFiles(true);
    setUploadError(null);

    try {
      const MAX_FILES_PER_LEAD = 10;
      const currentFilesCount = files.length;
      const filesToAttach = selectedBaseFiles.size;
      
      // Проверка текущего количества файлов у лида
      if (currentFilesCount + filesToAttach > MAX_FILES_PER_LEAD) {
        setUploadError(formatMessage(t('checklist.maxFilesPerLead'), { max: MAX_FILES_PER_LEAD, current: currentFilesCount, adding: filesToAttach }));
        setIsAttachingBaseFiles(false);
        return;
      }

      const fileIds = Array.from(selectedBaseFiles);
      const response = await libraryCrmService.attachBaseFilesToLead(leadId, fileIds);

      if (response.success) {
        // Очищаем выбранные файлы
        setSelectedBaseFiles(new Set());
        // Перезагружаем файлы лида
        await loadLeadFiles();
        // Переключаемся на категорию "Личные" чтобы показать привязанные файлы
        setFilesCategory('personal');
      } else {
        setUploadError(response.message || t('checklist.failedAttachFiles'));
      }
    } catch (error: any) {
      console.error('Failed to attach base files:', error);
      const errorMessage = error.response?.data?.message || error.message || t('checklist.attachError');
      setUploadError(errorMessage);
    } finally {
      setIsAttachingBaseFiles(false);
    }
  }, [leadId, selectedBaseFiles, loadLeadFiles, files.length]);

  // Обработка выбора базового файла
  const handleToggleBaseFile = useCallback((fileId: string) => {
    setSelectedBaseFiles(prev => {
      const newSet = new Set(prev);
      if (newSet.has(fileId)) {
        newSet.delete(fileId);
      } else {
        newSet.add(fileId);
      }
      return newSet;
    });
  }, []);

  // Загрузка файлов библиотеки риелтора
  const loadLibraryFiles = useCallback(async (folderId?: string | null) => {
    setIsLoadingLibraryFiles(true);
    try {
      const response = await libraryCrmService.getRealtorLibraryFiles(folderId || null, true);
      if (response.success && response.data) {
        const files = response.data.files || [];
        const folders = response.data.folders || [];
        setLibraryFiles(files);
        setLibraryFolders(folders);
      } else {
        console.error('Failed to load library files:', response.message);
        setLibraryFiles([]);
        setLibraryFolders([]);
      }
    } catch (error) {
      console.error('Failed to load library files:', error);
      setLibraryFiles([]);
      setLibraryFolders([]);
    } finally {
      setIsLoadingLibraryFiles(false);
    }
  }, [selectedLibraryProductType]);

  // Загрузка файлов в библиотеку
  const handleUploadLibraryFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = event.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;

    setIsUploadingLibraryFiles(true);
    setUploadError(null);

    try {
      const filesArray = Array.from(selectedFiles);
      

      if (filesArray.length > 10) {
        setUploadError(t('checklist.maxFilesPerUpload'));
        setIsUploadingLibraryFiles(false);
        return;
      }

      const rejected = findRejectedUpload(filesArray);
      if (rejected) {
        setUploadError(formatMessage(t('checklist.fileTooLarge'), { name: rejected.name }));
        setIsUploadingLibraryFiles(false);
        return;
      }

      const response = await libraryCrmService.uploadLibraryFiles(filesArray, currentFolderId);

      if (response.success) {
        await loadLibraryFiles(currentFolderId);
        if (libraryFileInputRef.current) {
          libraryFileInputRef.current.value = '';
        }
      } else {
        setUploadError(response.message || t('checklist.uploadErrorLibrary'));
      }
    } catch (error: any) {
      console.error('Failed to upload library files:', error);
      setUploadError(error.response?.data?.message || t('checklist.uploadErrorLibrary'));
    } finally {
      setIsUploadingLibraryFiles(false);
    }
  };

  // Привязка файлов из библиотеки к лиду
  const handleAttachLibraryFiles = useCallback(async () => {
    if (!leadId || selectedLibraryFiles.size === 0) return;

    setIsAttachingLibraryFiles(true);
    setUploadError(null);

    try {
      const MAX_FILES_PER_LEAD = 10;
      const currentFilesCount = files.length;
      const filesToAttach = selectedLibraryFiles.size;
      
      // Проверка текущего количества файлов у лида
      if (currentFilesCount + filesToAttach > MAX_FILES_PER_LEAD) {
        setUploadError(formatMessage(t('checklist.maxFilesPerLead'), { max: MAX_FILES_PER_LEAD, current: currentFilesCount, adding: filesToAttach }));
        setIsAttachingLibraryFiles(false);
        return;
      }

      const fileIds = Array.from(selectedLibraryFiles);
      const response = await libraryCrmService.attachLibraryFilesToLead(leadId, fileIds);

      if (response.success) {
        // Очищаем выбранные файлы
        setSelectedLibraryFiles(new Set());
        // Перезагружаем файлы лида
        await loadLeadFiles();
        // Переключаемся на категорию "Личные" чтобы показать привязанные файлы
        setFilesCategory('personal');
      } else {
        setUploadError(response.message || t('checklist.failedAttachFiles'));
      }
    } catch (error: any) {
      console.error('Failed to attach library files:', error);
      const errorMessage = error.response?.data?.message || error.message || t('checklist.attachError');
      setUploadError(errorMessage);
    } finally {
      setIsAttachingLibraryFiles(false);
    }
  }, [leadId, selectedLibraryFiles, loadLeadFiles, files.length]);

  // Обработка выбора файла из библиотеки
  const handleToggleLibraryFile = useCallback((fileId: string) => {
    setSelectedLibraryFiles(prev => {
      const newSet = new Set(prev);
      if (newSet.has(fileId)) {
        newSet.delete(fileId);
      } else {
        newSet.add(fileId);
      }
      return newSet;
    });
  }, []);

  // Функции для работы с папками
  const handleCreateFolder = useCallback(async () => {
    if (!newFolderName.trim()) {
      setShowCreateFolderInput(false);
      return;
    }

    setIsCreatingFolder(true);
    try {
      const response = await libraryCrmService.createLibraryFolder(newFolderName.trim(), currentFolderId);
      if (response.success) {
        setNewFolderName('');
        setShowCreateFolderInput(false);
        await loadLibraryFiles(currentFolderId);
      } else {
        setUploadError(response.message || t('checklist.createFolderError'));
      }
    } catch (error: any) {
      console.error('Failed to create folder:', error);
      setUploadError(error.response?.data?.message || t('checklist.createFolderError'));
    } finally {
      setIsCreatingFolder(false);
    }
  }, [newFolderName, currentFolderId, loadLibraryFiles]);

  const handleDeleteFolderClick = useCallback(async (folder: LibraryFolder) => {
    // Проверяем, есть ли в папке файлы или подпапки
    try {
      const checkResponse = await libraryCrmService.getRealtorLibraryFiles(folder._id, true);
      if (checkResponse.success && checkResponse.data) {
        const filesCount = checkResponse.data.files?.length || 0;
        const foldersCount = checkResponse.data.folders?.length || 0;
        
        if (filesCount > 0 || foldersCount > 0) {
          showToast(formatMessage(t('checklist.folderNotEmpty'), { name: folder.name, files: filesCount, folders: foldersCount }), 'warning');
          return;
        }
      }
    } catch (error) {
      console.error('Failed to check folder contents:', error);
    }

    setDeleteFolderConfirm({ isOpen: true, folder });
  }, [showToast]);

  const handleDeleteFolderConfirm = useCallback(async () => {
    if (!deleteFolderConfirm.folder) return;

    const folder = deleteFolderConfirm.folder;
    setDeleteFolderConfirm({ isOpen: false, folder: null });
    setDeletingFolderId(folder._id);
    
    try {
      const response = await libraryCrmService.deleteLibraryFolder(folder._id);
      if (response.success) {
        await loadLibraryFiles(currentFolderId);
        showToast(t('checklist.folderDeleted'), 'success');
      } else {
        showToast(response.message || t('checklist.deleteFolderError'), 'error');
      }
    } catch (error: any) {
      console.error('Failed to delete folder:', error);
      showToast(error.response?.data?.message || t('checklist.deleteFolderError'), 'error');
    } finally {
      setDeletingFolderId(null);
    }
  }, [deleteFolderConfirm.folder, loadLibraryFiles, currentFolderId, showToast]);

  const handleNavigateToFolder = useCallback((folder: LibraryFolder) => {
    const newPath = [...folderPath];
    // Если мы находимся в папке, добавляем её в путь
    if (currentFolderId && currentFolderName) {
      // Используем сохраненное название, если текущая папка не найдена в libraryFolders
      const currentFolder = libraryFolders.find(f => f._id === currentFolderId) || {
        _id: currentFolderId,
        name: currentFolderName,
        parentId: null,
        createdBy: {
          _id: '',
          name: '',
          email: ''
        },
        createdAt: '',
        updatedAt: ''
      };
      // Проверяем, что эта папка еще не в пути (избегаем дубликатов)
      if (!newPath.some(p => p._id === currentFolderId)) {
        newPath.push(currentFolder);
      }
    }
    setFolderPath(newPath);
    setCurrentFolderId(folder._id);
    setCurrentFolderName(folder.name);
    // Загружаем файлы и папки из выбранной папки
    loadLibraryFiles(folder._id);
  }, [folderPath, currentFolderId, currentFolderName, libraryFolders, loadLibraryFiles]);

  const handleNavigateBack = useCallback((index: number) => {
    if (index === -1) {
      // Возврат в корень
      setCurrentFolderId(null);
      setCurrentFolderName(null);
      setFolderPath([]);
      loadLibraryFiles(null);
    } else {
      // Возврат к определенной папке
      const newPath = folderPath.slice(0, index + 1);
      const targetFolder = newPath[newPath.length - 1];
      setFolderPath(newPath);
      setCurrentFolderId(targetFolder._id);
      setCurrentFolderName(targetFolder.name);
      loadLibraryFiles(targetFolder._id);
    }
  }, [folderPath, loadLibraryFiles]);

  const handleDeleteFileClick = useCallback((filename: string, originalName?: string) => {
    if (!leadId) return;
    setDeleteLeadFileConfirm({ isOpen: true, filename, originalName });
  }, [leadId]);

  const handleDeleteFileConfirm = useCallback(async () => {
    if (!leadId || !deleteLeadFileConfirm.filename) return;
    
    const filename = deleteLeadFileConfirm.filename;
    setDeleteLeadFileConfirm({ isOpen: false, filename: null });
    
    try {
      const response = await leadCrmService.deleteLeadFileByName(leadId, filename);
      if (response.success) {
        await loadLeadFiles();
        showToast(t('checklist.fileDeleted'), 'success');
      } else {
        showToast(t('checklist.deleteFileError'), 'error');
      }
    } catch (error: any) {
      console.error('Failed to delete file:', error);
      showToast(error.response?.data?.message || t('checklist.deleteFileError'), 'error');
    }
  }, [leadId, deleteLeadFileConfirm.filename, loadLeadFiles, showToast]);

  const getFileIcon = useCallback((mimeType: string, size: number = 20) => {
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
  }, []);

  const handleDownloadFile = useCallback((file: { filename: string; originalName: string; mimeType: string; size: number; url: string }) => {
    if (!leadId) return;
    void openLeadFile(leadId, file).catch((error: unknown) => {
      console.error('Failed to open lead file:', error);
      setUploadError(t('crmLibrary.openFailed'));
    });
  }, [leadId, t]);

  const handleOpenLibraryFile = useCallback((file: LeadFile & { _id?: string }) => {
    if (!file._id) return;
    void libraryCrmService.openLibraryFile({ ...file, _id: file._id }).catch((error: unknown) => {
      console.error('Failed to open library file:', error);
      setUploadError(t('crmLibrary.openFailed'));
    });
  }, [t]);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = event.target.files;
    if (!selectedFiles || selectedFiles.length === 0 || !leadId) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      const filesArray = Array.from(selectedFiles);
      
      // Константы валидации
      const MAX_FILES_PER_LEAD = 10;
      const MAX_FILES_PER_UPLOAD = 10;
      

      // Проверка количества файлов в запросе
      if (filesArray.length > MAX_FILES_PER_UPLOAD) {
        setUploadError(formatMessage(t('checklist.maxFilesAtOnce'), { max: MAX_FILES_PER_UPLOAD }));
        setIsUploading(false);
        return;
      }

      // Проверка текущего количества файлов у лида
      const currentFilesCount = files.length;
      if (currentFilesCount + filesArray.length > MAX_FILES_PER_LEAD) {
        setUploadError(formatMessage(t('checklist.maxFilesPerLead'), { max: MAX_FILES_PER_LEAD, current: currentFilesCount, adding: filesArray.length }));
        setIsUploading(false);
        return;
      }

      const tooLarge = findRejectedUpload(filesArray);
      if (tooLarge) {
        setUploadError(formatMessage(t('checklist.fileTooLarge'), { name: tooLarge.name }));
        setIsUploading(false);
        return;
      }

      const response = await leadCrmService.uploadLeadFiles(leadId, filesArray);

      if (response.success) {
        await loadLeadFiles();
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      } else {
        setUploadError(response.message || t('checklist.uploadError'));
      }
    } catch (error: any) {
      console.error('Failed to upload files:', error);
      const errorMessage = error.response?.data?.message || error.message || t('checklist.uploadError');
      setUploadError(errorMessage);
    } finally {
      setIsUploading(false);
    }
  };

  // Загрузка файлов при открытии модалки
  useEffect(() => {
    if (isFilesModalOpen) {
      if (leadId) {
        loadLeadFiles();
      }
      loadBaseFiles();
      loadLibraryFiles(currentFolderId);
    } else if (!isFilesModalOpen) {
      setFiles([]);
      setBaseFiles([]);
      setLibraryFiles([]);
      setLibraryFolders([]);
      setSelectedBaseFiles(new Set());
      setSelectedLibraryFiles(new Set());
      setUploadError(null);
      setFilesCategory('common');
      setCurrentFolderId(null);
      setCurrentFolderName(null);
      setFolderPath([]);
    }
  }, [isFilesModalOpen, leadId, selectedLibraryProductType, currentFolderId, loadLeadFiles, loadBaseFiles, loadLibraryFiles]);

  // Загрузка библиотеки при изменении папки или типа продукта
  useEffect(() => {
    if (isFilesModalOpen && filesCategory === 'library') {
      loadLibraryFiles(currentFolderId);
    }
  }, [currentFolderId, isFilesModalOpen, filesCategory, selectedLibraryProductType, loadLibraryFiles]);

  const decodeFilename = (name?: string): string => {
    if (!name) return t('checklist.fileUntitled');
    try {
      return decodeURIComponent(escape(name)) || name;
    } catch {
      return name;
    }
  };

  const handleSaveQuickNote = async () => {
    if (!quickNoteText.trim()) {
      return;
    }

    setIsSaving(true);
    try {
      // Получаем существующий комментарий этапа
      const existingCommentResponse = await leadCrmService.getStageComment(leadId, stage);
      
      let commentToSave = quickNoteText.trim();
      
      // Если существует предыдущий комментарий, добавляем новый с новой строкой и абзацем
      if (existingCommentResponse.success && existingCommentResponse.data && existingCommentResponse.data.comment) {
        const existingComment = existingCommentResponse.data.comment.trim();
        // Добавляем новый комментарий с двойным переносом строки для абзаца
        commentToSave = `${existingComment}\n\n${commentToSave}`;
      }
      
      // Сохраняем комментарий (обновленный или новый)
      const response = await leadCrmService.createStageComment(leadId, stage, commentToSave);
      
      if (!response.success) {
        throw new Error('Не удалось сохранить комментарий этапа');
      }

      // Очищаем поле после успешного сохранения
      setQuickNoteText('');
      
      // Мгновенно обновляем историю, чтобы комментарий отобразился сразу
      if (onCommentSaved) {
        onCommentSaved();
      }
    } catch (error) {
      console.error('Ошибка при сохранении комментария этапа:', error);
      alert(t('checklist.failedSaveComment'));
    } finally {
      setIsSaving(false);
    }
  };

  const totalWeightsPerIndicator = currentAllChecklistTasks.reduce((totals, { task }) => {
    task.weights.forEach((weight, idx) => {
      totals[idx] += weight;
    });
    return totals;
  }, Array.from({ length: currentTrustIndicators.length }, () => 0));

  const completedWeightsPerIndicator = currentAllChecklistTasks.reduce((totals, { stage: taskStage, index, task }) => {
    const key = getStorageKey(taskStage, index);
    if (!checkedItems[key]) return totals;
    task.weights.forEach((weight, idx) => {
      totals[idx] += weight;
    });
    return totals;
  }, Array.from({ length: currentTrustIndicators.length }, () => 0));

  const indicatorScores = totalWeightsPerIndicator.map((total, idx) => {
    if (total === 0) return 0;
    return Math.min(150, (completedWeightsPerIndicator[idx] / total) * 150);
  });

  const indicatorProgress = indicatorScores.map((score) => Math.max(0, Math.min(1, score / 150)));

  const sortedScores = [...indicatorScores].sort((a, b) => a - b);
  const sumOfFourSmallest = sortedScores.slice(0, 4).reduce((sum, value) => sum + value, 0);
  const averageOfFourSmallest = sumOfFourSmallest / 4;
  const probabilityPercent = Math.min(100, (averageOfFourSmallest / 150) * 100);

  // Если нет данных для этапа, показываем сообщение
  if (stageChecklist.correct.length === 0 && stageChecklist.incorrect.length === 0) {
    return (
      <div className="flex flex-col h-full items-center justify-center animate-fade-in">
        <div className="text-sm text-gray-400">{t('checklist.noRecommendations')}</div>
      </div>
    );
  }

  const circleSize = 128;
  const circleStroke = 10;
  const circleRadius = (circleSize - circleStroke) / 2;
  const circleCircumference = 2 * Math.PI * circleRadius;
  const boundedProbability = Math.max(0, Math.min(100, probabilityPercent));
  const readinessPercent = Math.round(boundedProbability);
  const strokeDashoffset = circleCircumference - (boundedProbability / 100) * circleCircumference;

  return (
    <div className="flex flex-col h-full animate-fade-in" style={{ fontFamily: 'Inter, system-ui, -apple-system, sans-serif' }}>
      <div className="mb-3 flex items-center gap-3 w-full">
        <div className="text-lg font-normal text-gray-900 flex-shrink-0">{leadName || '—'}</div>
        
        {/* Текстовое поле для быстрого добавления информации - на всю ширину до кнопки, с отступом справа для крестика */}
        <div className="flex items-center gap-2 flex-1 min-w-0 pr-10">
          <input
            type="text"
            value={quickNoteText}
            onChange={(e) => setQuickNoteText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSaveQuickNote();
              }
            }}
            placeholder={t('checklist.quickNotePlaceholder')}
            className="flex-1 min-w-0 px-4 py-2 rounded focus:outline-none text-base"
            style={{
              backgroundColor: 'rgba(3,29,22,0.5)',
              borderBottom: '1px solid #1e4a2a',
              borderTop: 'none',
              borderLeft: 'none',
              borderRight: 'none',
              color: 'rgba(255,255,255,0.88)'
            }}
            disabled={isSaving}
          />
          <button
            onClick={handleSaveQuickNote}
            disabled={!quickNoteText.trim() || isSaving}
            className="px-4 py-2 bg-dream-primary text-white rounded-lg hover:bg-green-700 transition-colors font-normal disabled:opacity-50 disabled:cursor-not-allowed text-sm whitespace-nowrap flex-shrink-0"
          >
            {isSaving ? t('checklist.saving') : t('checklist.save')}
          </button>
          <button
            onClick={() => {
              setIsFilesModalOpen(true);
            }}
            className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-normal flex items-center justify-center gap-2"
            title={t('checklist.filesTitle')}
          >
            <svg width="20" height="20" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M18 3H14C12.6744 3.00156 11.4035 3.52885 10.4662 4.46619C9.52885 5.40353 9.00156 6.6744 9 8V28C9 28.2652 9.10536 28.5196 9.29289 28.7071C9.48043 28.8946 9.73478 29 10 29C10.2652 29 10.5196 28.8946 10.7071 28.7071C10.8946 28.5196 11 28.2652 11 28V8C11.0009 7.20462 11.3172 6.44206 11.8796 5.87964C12.4421 5.31722 13.2046 5.00087 14 5H18C18.7954 5.00087 19.5579 5.31722 20.1204 5.87964C20.6828 6.44206 20.9991 7.20462 21 8V24C21 24.7956 20.6839 25.5587 20.1213 26.1213C19.5587 26.6839 18.7956 27 18 27C17.2044 27 16.4413 26.6839 15.8787 26.1213C15.3161 25.5587 15 24.7956 15 24V11C15 10.7348 15.1054 10.4804 15.2929 10.2929C15.4804 10.1054 15.7348 10 16 10C16.2652 10 16.5196 10.1054 16.7071 10.2929C16.8946 10.4804 17 10.7348 17 11V23C17 23.2652 17.1054 23.5196 17.2929 23.7071C17.4804 23.8946 17.7348 24 18 24C18.2652 24 18.5196 23.8946 18.7071 23.7071C18.8946 23.5196 19 23.2652 19 23V11C19 10.2044 18.6839 9.44129 18.1213 8.87868C17.5587 8.31607 16.7956 8 16 8C15.2044 8 14.4413 8.31607 13.8787 8.87868C13.3161 9.44129 13 10.2044 13 11V24C13 25.3261 13.5268 26.5979 14.4645 27.5355C15.4021 28.4732 16.6739 29 18 29C19.3261 29 20.5979 28.4732 21.5355 27.5355C22.4732 26.5979 23 25.3261 23 24V8C22.9984 6.6744 22.4712 5.40353 21.5338 4.46619C20.5965 3.52885 19.3256 3.00156 18 3Z" fill="#555454"/>
            </svg>
            <span className="text-sm">{t('checklist.files')}</span>
          </button>
        </div>
      </div>
      <div
        className="flex-1 grid gap-6 overflow-x-auto"
        style={{ gridTemplateColumns: 'minmax(0,40%) minmax(0,60%)' }}
      >
      <div className="flex flex-col rounded-[14px] border border-dream-secondary bg-white p-4 shadow-[0_10px_30px_rgba(0,0,0,0.06)] overflow-y-auto">
        <div className="text-base font-normal text-gray-800 mb-3">{t('checklist.tasksList')}</div>
        <div className="space-y-1.5 w-fit" style={{ maxWidth: '40vw' }}>
          {stageChecklist.correct.map((item, index) => {
            const key = getStorageKey(stage, index);
            const isChecked = checkedItems[key] || false;
            return (
              <div
                key={index}
                className={`transition-all duration-200 rounded-lg text-xs leading-relaxed animate-fade-in w-full ${
                  isChecked
                    ? 'bg-gray-50 border border-gray-200 h-8.5 p-1.5 flex items-center'
                    : 'bg-green-50 border border-green-200 p-2'
                }`}
                style={{
                  animationDelay: `${index * 50}ms`,
                }}
              >
                <label className="flex items-center gap-2 cursor-pointer w-full">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={(e) => handleCheckboxChange(stage, index, e.target.checked)}
                    className="sr-only"
                  />
                  <div
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all duration-200 flex-shrink-0 ${
                      isChecked ? 'bg-dream-primary border-dream-primary' : 'bg-white border-dream-primary'
                    }`}
                  >
                    {isChecked && (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M10 3L4.5 8.5L2 6" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </div>
                  <span className={`flex-1 transition-all duration-200 text-base ${isChecked ? 'text-gray-400' : 'text-gray-900'}`}>
                    {item.label}
                  </span>
                </label>
              </div>
            );
          })}
        </div>
      </div>
      <div className="w-full flex flex-col rounded-[14px] border border-dream-secondary bg-white p-4 shadow-[0_10px_30px_rgba(0,0,0,0.06)]">
        <div className="w-full flex items-center gap-4 mt-4">
          {/* Левая колонка — первые 3 индикатора */}
          <div className="flex flex-col justify-center gap-3" style={{ width: '30%' }}>
            {currentTrustIndicators.slice(0, 3).map((label, labelIndex) => {
              const progress = indicatorProgress[labelIndex];
              const progressWidth = `${Math.round(progress * 100)}%`;
              return (
                <div key={label} className="flex flex-col gap-1">
                  <div
                    className="uppercase leading-tight font-normal text-center"
                    style={{ fontWeight: 400, fontSize: '16px', letterSpacing: '0.2em', color: '#374151', WebkitFontSmoothing: 'antialiased' }}
                  >
                    {label}
                  </div>
                  <div className="h-1.5 w-full bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full bg-[#169600] rounded-full" style={{ width: progressWidth }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Центр — кольцо */}
          <div className="flex flex-col items-center justify-center gap-2 flex-shrink-0" style={{ width: '40%' }}>
            <div className="relative">
              <svg
                width={circleSize}
                height={circleSize}
                viewBox={`0 0 ${circleSize} ${circleSize}`}
                xmlns="http://www.w3.org/2000/svg"
                className="rounded-full shadow-[0_10px_40px_rgba(0,0,0,0.12)]"
              >
                <g transform={`rotate(-90 ${circleSize / 2} ${circleSize / 2})`}>
                  <circle
                    cx={circleSize / 2}
                    cy={circleSize / 2}
                    r={circleRadius}
                    fill="none"
                    stroke="#E5E7EB"
                    strokeWidth={circleStroke}
                  />
                  <circle
                    cx={circleSize / 2}
                    cy={circleSize / 2}
                    r={circleRadius}
                    fill="none"
                    stroke="#169600"
                    strokeWidth={circleStroke}
                    strokeDasharray={circleCircumference}
                    strokeDashoffset={strokeDashoffset}
                    strokeLinecap="round"
                    className="transition-all duration-300"
                  />
                </g>
                <circle cx={circleSize / 2} cy={circleSize / 2} r={circleRadius - 12} fill="#F8FAFC" />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-2xl font-normal text-[#169600]">
                  {Math.round(readinessPercent)}%
                </span>
              </div>
            </div>
            <div
              className="uppercase text-center font-normal"
              style={{ fontWeight: 400, fontSize: '16px', letterSpacing: '0.25em', color: '#374151', WebkitFontSmoothing: 'antialiased' }}
            >
              {t('checklist.dealProbability')}
            </div>
          </div>

          {/* Правая колонка — последние 3 индикатора */}
          <div className="flex flex-col justify-center gap-3" style={{ width: '30%' }}>
            {currentTrustIndicators.slice(3).map((label, labelIndex) => {
              const progress = indicatorProgress[labelIndex + 3];
              const progressWidth = `${Math.round(progress * 100)}%`;
              return (
                <div key={label} className="flex flex-col gap-1">
                  <div
                    className="uppercase leading-tight font-normal text-center"
                    style={{ fontWeight: 400, fontSize: '16px', letterSpacing: '0.2em', color: '#374151', WebkitFontSmoothing: 'antialiased' }}
                  >
                    {label}
                  </div>
                  <div className="h-1.5 w-full bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full bg-[#169600] rounded-full" style={{ width: progressWidth }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      </div>
      
      {/* Модалка файлов лида */}
      {isFilesModalOpen && createPortal(
        <div
          className="modal-fade-in fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[100000] p-4"
          onClick={() => setIsFilesModalOpen(false)}
        >
          <div 
            className="bg-white rounded-[25px] shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div className="flex flex-col">
                <h2 className="text-xl font-normal text-gray-800">{t('checklist.filesTitle')}</h2>
                <div className="flex items-center gap-4 mt-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="checklist-library-product"
                      value="SALES"
                      checked={selectedLibraryProductType === ProductType.SALES}
                      onChange={() => setSelectedLibraryProductType(ProductType.SALES)}
                      className="sr-only"
                    />
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all duration-200 ${
                      selectedLibraryProductType === ProductType.SALES
                        ? 'border-dream-primary bg-white'
                        : 'border-gray-500'
                    }`}>
                      {selectedLibraryProductType === ProductType.SALES && (
                        <div className="w-2 h-2 rounded-full bg-dream-primary" />
                      )}
                    </div>
                    <span className={"text-sm " + (selectedLibraryProductType === ProductType.SALES ? 'text-dream-primary font-medium' : 'text-gray-500')}>
                      {t('checklist.productSales')}
                    </span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="checklist-library-product"
                      value="NETWORK"
                      checked={selectedLibraryProductType === ProductType.NETWORK}
                      onChange={() => setSelectedLibraryProductType(ProductType.NETWORK)}
                      className="sr-only"
                    />
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all duration-200 ${
                      selectedLibraryProductType === ProductType.NETWORK
                        ? 'border-dream-primary bg-white'
                        : 'border-gray-500'
                    }`}>
                      {selectedLibraryProductType === ProductType.NETWORK && (
                        <div className="w-2 h-2 rounded-full bg-dream-primary" />
                      )}
                    </div>
                    <span className={"text-sm " + (selectedLibraryProductType === ProductType.NETWORK ? 'text-dream-primary font-medium' : 'text-gray-500')}>
                      {t('checklist.productNetwork')}
                    </span>
                  </label>
                </div>
              </div>
              <button
                onClick={() => setIsFilesModalOpen(false)}
                className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors"
                aria-label={t('common.close')}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>

            {/* Табы для категорий */}
            <div className="flex border-b border-gray-200 px-6">
              <button
                onClick={() => setFilesCategory('common')}
                className={`px-4 py-3 font-medium text-sm transition-colors border-b-2 ${
                  filesCategory === 'common'
                    ? 'border-dream-primary text-dream-primary'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t('checklist.libraryCommon')}
              </button>
              <button
                onClick={() => setFilesCategory('library')}
                className={`px-4 py-3 font-medium text-sm transition-colors border-b-2 ${
                  filesCategory === 'library'
                    ? 'border-dream-primary text-dream-primary'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t('checklist.libraryPersonal')}
              </button>
              <button
                onClick={() => setFilesCategory('personal')}
                className={`px-4 py-3 font-medium text-sm transition-colors border-b-2 ${
                  filesCategory === 'personal'
                    ? 'border-dream-primary text-dream-primary'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t('checklist.libraryLead')}
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6">
              {uploadError && (
                <div className="w-full p-3 bg-red-100 text-red-600 rounded-lg text-sm mb-4">
                  {uploadError}
                </div>
              )}

              {/* Общая библиотека - файлы, управляемые только системой. Доступны для просмотра/скачивания/добавления к лиду */}
              {filesCategory === 'common' && (
                <div className="w-full">
                  <div className="mb-4 p-3 rounded" style={{ background: '#112d1c', boxShadow: 'inset 0 0 0 1px rgba(201,168,76,0.18)' }}>
                    <p className="text-base" style={{ color: '#d0e8df' }}>
                      {formatMessage(t('checklist.libraryHint'), {
                        product: selectedLibraryProductType === ProductType.SALES
                          ? t('checklist.productSales')
                          : t('checklist.productNetwork'),
                      })}
                    </p>
                  </div>
                  {isLoadingBaseFiles ? (
                    <div className="flex items-center justify-center py-8">
                      <svg className="animate-spin h-6 w-6 text-dream-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span className="ml-2 text-gray-600">{t('checklist.loadingBaseFiles')}</span>
                    </div>
                  ) : baseFiles.length > 0 ? (
                    <>
                      <div className="w-full flex flex-col gap-2 mb-4">
                        {baseFiles.map((file, index) => {
                          const fileId = file._id || file.filename;
                          const isSelected = selectedBaseFiles.has(fileId);
                          return (
                            <div
                              key={fileId || index}
                              className={`flex items-center gap-3 p-3 rounded-lg border-2 transition-all ${
                                isSelected
                                  ? 'border-dream-primary'
                                  : 'bg-gray-50 border-gray-200 hover:border-gray-300'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleToggleBaseFile(fileId)}
                                className="w-5 h-5 rounded border-2 border-dream-primary cursor-pointer"
                              />
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                {file.mimeType?.includes('image') && file.url ? (
                                  <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 bg-gray-200">
                                    <img 
                                      src={file.url} 
                                      alt={decodeFilename(file.originalName)}
                                      className="w-full h-full object-cover"
                                      onError={(e) => {
                                        (e.target as HTMLImageElement).style.display = 'none';
                                      }}
                                    />
                                  </div>
                                ) : (
                                  getFileIcon(file.mimeType || '', 20)
                                )}
                                <div className="flex flex-col min-w-0 flex-1">
                                  <span className="text-sm font-medium truncate">{decodeFilename(file.originalName)}</span>
                                  <span className="text-xs text-gray-500">{(() => {
                                    if (file.size === 0) return '0 Bytes';
                                    const k = 1024;
                                    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
                                    const i = Math.floor(Math.log(file.size) / Math.log(k));
                                    return Math.round(file.size / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
                                  })()}</span>
                                </div>
                              </div>
                              <button
                                onClick={() => handleOpenLibraryFile(file)}
                                className="cursor-pointer p-2 hover:bg-gray-100 rounded transition-colors"
                                title={t('common.download')}
                              >
                                <Download size={18} className="text-dream-primary" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                      {selectedBaseFiles.size > 0 && (
                        <button
                          onClick={handleAttachBaseFiles}
                          disabled={isAttachingBaseFiles || !leadId}
                          className="w-full py-3 px-4 bg-dream-primary text-white rounded-lg hover:bg-green-700 transition-colors font-normal disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                          {isAttachingBaseFiles ? (
                            <>
                              <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                              <span>{t('checklist.savingShort')}</span>
                            </>
                          ) : (
                            <span>{formatMessage(t('checklist.saveForLead'), { count: selectedBaseFiles.size })}</span>
                          )}
                        </button>
                      )}
                    </>
                  ) : (
                    <div className="text-gray-500 text-sm text-center py-8">{t('checklist.noBaseFiles')}</div>
                  )}
                </div>
              )}

              {/* Личная библиотека - файлы риелтора */}
              {filesCategory === 'library' && (
                <div className="w-full">
                  {/* Навигация по папкам */}
                  <div className="mb-4 flex flex-col gap-2">
                    <div className="mb-3 flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => handleNavigateBack(-1)}
                        className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                          !currentFolderId
                            ? 'bg-dream-primary text-white font-medium'
                            : 'border border-gray-300 bg-white hover:bg-gray-50 text-gray-700'
                        }`}
                      >
                        {t('checklist.folderHome')}
                      </button>
                      {folderPath.map((folder, index) => (
                        <React.Fragment key={folder._id}>
                          <span className="text-gray-400">/</span>
                          <button
                            onClick={() => handleNavigateBack(index)}
                            className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
                          >
                            {folder.name}
                          </button>
                        </React.Fragment>
                      ))}
                      {currentFolderId && currentFolderName && (
                        <>
                          <span className="text-gray-400">/</span>
                          <span className="px-3 py-1.5 text-sm text-gray-800 font-medium">
                            {currentFolderName}
                          </span>
                        </>
                      )}
                    </div>
                    
                    {/* Список папок в текущей директории и кнопка создания */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {libraryFolders.length > 0 && (
                        <>
                          <span className="text-xs text-gray-500 font-medium">{t('checklist.foldersLabel')}</span>
                          {libraryFolders.map((folder) => (
                            <button
                              key={folder._id}
                              onClick={() => handleNavigateToFolder(folder)}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-yellow-300 bg-yellow-50 hover:bg-yellow-100 text-gray-700 transition-colors group"
                              title={formatMessage(t('checklist.openFolder'), { name: folder.name })}
                            >
                              <Folder size={16} className="text-yellow-600" />
                              <span>{folder.name}</span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteFolderClick(folder);
                                }}
                                disabled={deletingFolderId === folder._id}
                                className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                                title={t('checklist.deleteFolder')}
                              >
                                {deletingFolderId === folder._id ? (
                                  <svg className="animate-spin h-3 w-3 text-red-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                  </svg>
                                ) : (
                                  <Trash2 size={14} className="text-red-600" />
                                )}
                              </button>
                            </button>
                          ))}
                        </>
                      )}
                      
                      {/* Кнопка создания папки */}
                      {showCreateFolderInput ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={newFolderName}
                            onChange={(e) => setNewFolderName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleCreateFolder();
                              } else if (e.key === 'Escape') {
                                setShowCreateFolderInput(false);
                                setNewFolderName('');
                              }
                            }}
                            placeholder={t('checklist.folderNamePlaceholder')}
                            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-dream-primary"
                            autoFocus
                          />
                          <button
                            onClick={handleCreateFolder}
                            disabled={isCreatingFolder || !newFolderName.trim()}
                            className="px-3 py-1.5 text-sm bg-dream-primary text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
                          >
                            {isCreatingFolder ? t('checklist.creatingFolder') : t('common.create')}
                          </button>
                          <button
                            onClick={() => {
                              setShowCreateFolderInput(false);
                              setNewFolderName('');
                            }}
                            className="px-3 py-1.5 text-sm bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                          >
                            {t('common.cancel')}
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setShowCreateFolderInput(true)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-dashed border-gray-400 bg-white hover:bg-gray-50 text-gray-700 transition-colors"
                          title={t('checklist.createFolder')}
                        >
                          <FolderPlus size={16} className="text-gray-600" />
                          <span>{t('checklist.createFolder')}</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {isLoadingLibraryFiles ? (
                    <div className="flex items-center justify-center py-8">
                      <svg className="animate-spin h-6 w-6 text-dream-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span className="ml-2 text-gray-600">{t('checklist.loadingLibrary')}</span>
                    </div>
                  ) : (libraryFiles.length > 0 || libraryFolders.length > 0) ? (
                    <>
                      <div className="w-full flex flex-col gap-2 mb-4">
                        {libraryFiles.map((file, index) => {
                          const fileId = file._id || file.filename;
                          const isSelected = selectedLibraryFiles.has(fileId);
                          return (
                            <div
                              key={fileId || index}
                              className={`flex items-center gap-3 p-3 rounded-lg border-2 transition-all ${
                                isSelected
                                  ? 'border-dream-primary'
                                  : 'bg-gray-50 border-gray-200 hover:border-gray-300'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleToggleLibraryFile(fileId)}
                                className="w-5 h-5 rounded border-2 border-dream-primary cursor-pointer"
                              />
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                {file.mimeType?.includes('image') && file.url ? (
                                  <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 bg-gray-200">
                                    <img 
                                      src={file.url} 
                                      alt={decodeFilename(file.originalName)}
                                      className="w-full h-full object-cover"
                                      onError={(e) => {
                                        (e.target as HTMLImageElement).style.display = 'none';
                                      }}
                                    />
                                  </div>
                                ) : (
                                  getFileIcon(file.mimeType || '', 24)
                                )}
                                <div className="flex flex-col min-w-0 flex-1">
                                  <span className="text-sm font-medium truncate">{decodeFilename(file.originalName)}</span>
                                  <span className="text-xs text-gray-500">{(() => {
                                    if (file.size === 0) return '0 Bytes';
                                    const k = 1024;
                                    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
                                    const i = Math.floor(Math.log(file.size) / Math.log(k));
                                    return Math.round(file.size / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
                                  })()}</span>
                                </div>
                              </div>
                              <button
                                onClick={() => handleOpenLibraryFile(file)}
                                className="cursor-pointer p-2 hover:bg-gray-100 rounded transition-colors"
                                title={t('common.download')}
                              >
                                <Download size={18} className="text-dream-primary" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                      {selectedLibraryFiles.size > 0 && (
                        <button
                          onClick={handleAttachLibraryFiles}
                          disabled={isAttachingLibraryFiles || !leadId}
                          className="w-full py-3 px-4 bg-dream-primary text-white rounded-lg hover:bg-green-700 transition-colors font-normal disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mb-4"
                        >
                          {isAttachingLibraryFiles ? (
                            <>
                              <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                              <span>{t('checklist.attaching')}</span>
                            </>
                          ) : (
                            <span>{formatMessage(t('checklist.attachToLead'), { count: selectedLibraryFiles.size })}</span>
                          )}
                        </button>
                      )}
                    </>
                  ) : libraryFiles.length === 0 && libraryFolders.length === 0 ? (
                    <div className="text-gray-500 text-sm text-center py-4 mb-4">{t('checklist.folderEmpty')}</div>
                  ) : null}
                  
                  {/* Кнопка загрузки файлов */}
                  <div className="flex flex-col gap-2 items-center mt-4">
                    <input
                      ref={libraryFileInputRef}
                      type="file"
                      multiple
                      onChange={handleUploadLibraryFiles}
                      className="hidden"
                      accept={UPLOAD_ACCEPT}
                    />
                    
                    <button 
                      type="button"
                      onClick={() => libraryFileInputRef.current?.click()}
                      disabled={isUploadingLibraryFiles}
                      className="flex items-center py-2 px-3 rounded-full border border-dashed border-gray-300 cursor-pointer hover:border-dream-primary hover:bg-dream-secondary/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed w-1/2"
                    >
                    {isUploadingLibraryFiles ? (
                      <>
                        <svg className="animate-spin h-5 w-5 mr-2 text-dream-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>{t('checklist.uploading')}</span>
                      </>
                    ) : (
                      <>
                        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M18 3H14C12.6744 3.00156 11.4035 3.52885 10.4662 4.46619C9.52885 5.40353 9.00156 6.6744 9 8V28C9 28.2652 9.10536 28.5196 9.29289 28.7071C9.48043 28.8946 9.73478 29 10 29C10.2652 29 10.5196 28.8946 10.7071 28.7071C10.8946 28.5196 11 28.2652 11 28V8C11.0009 7.20462 11.3172 6.44206 11.8796 5.87964C12.4421 5.31722 13.2046 5.00087 14 5H18C18.7954 5.00087 19.5579 5.31722 20.1204 5.87964C20.6828 6.44206 20.9991 7.20462 21 8V24C21 24.7956 20.6839 25.5587 20.1213 26.1213C19.5587 26.6839 18.7956 27 18 27C17.2044 27 16.4413 26.6839 15.8787 26.1213C15.3161 25.5587 15 24.7956 15 24V11C15 10.7348 15.1054 10.4804 15.2929 10.2929C15.4804 10.1054 15.7348 10 16 10C16.2652 10 16.5196 10.1054 16.7071 10.2929C16.8946 10.4804 17 10.7348 17 11V23C17 23.2652 17.1054 23.5196 17.2929 23.7071C17.4804 23.8946 17.7348 24 18 24C18.2652 24 18.5196 23.8946 18.7071 23.7071C18.8946 23.5196 19 23.2652 19 23V11C19 10.2044 18.6839 9.44129 18.1213 8.87868C17.5587 8.31607 16.7956 8 16 8C15.2044 8 14.4413 8.31607 13.8787 8.87868C13.3161 9.44129 13 10.2044 13 11V24C13 25.3261 13.5268 26.5979 14.4645 27.5355C15.4021 28.4732 16.6739 29 18 29C19.3261 29 20.5979 28.4732 21.5355 27.5355C22.4732 26.5979 23 25.3261 23 24V8C22.9984 6.6744 22.4712 5.40353 21.5338 4.46619C20.5965 3.52885 19.3256 3.00156 18 3Z" fill="#555454"/>
                        </svg>
                        <span>{t('checklist.uploadFiles')}</span>
                      </>
                    )}
                  </button>
                  </div>
                </div>
              )}

              {/* Библиотека лида - файлы, привязанные к конкретному лиду */}
              {filesCategory === 'personal' && (
                <div className="w-full">
                  {files.length > 0 ? (
                    <div className="w-full flex flex-col gap-2 mb-4">
                      {files.map((file, index) => (
                    <div key={index} className="flex items-center justify-between gap-2 p-3 pr-5 rounded-lg bg-gray-50 border border-gray-200">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {file.mimeType?.includes('image') && file.url ? (
                          <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 bg-gray-200">
                            <img 
                              src={file.url} 
                              alt={decodeFilename(file.originalName)}
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                              }}
                            />
                          </div>
                        ) : (
                          getFileIcon(file.mimeType || '', 20)
                        )}
                        <div className="flex flex-col min-w-0 flex-1">
                          <span className="text-sm font-medium truncate">{decodeFilename(file.originalName)}</span>
                          <span className="text-xs text-gray-500">{(() => {
                            if (file.size === 0) return '0 Bytes';
                            const k = 1024;
                            const sizes = ['Bytes', 'KB', 'MB', 'GB'];
                            const i = Math.floor(Math.log(file.size) / Math.log(k));
                            return Math.round(file.size / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
                          })()}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleDownloadFile(file)}
                          className="cursor-pointer"
                          title={t('common.download')}
                        >
                          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M9 12L5 8h3V3h2v5h3l-4 4z" fill="#169600"/>
                            <path d="M15 13v2H3v-2H1v2c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-2h-2z" fill="#169600"/>
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDeleteFileClick(file.filename, file.originalName)}
                          className="cursor-pointer"
                          title={t('common.delete')}
                        >
                          <svg width="25" height="25" viewBox="0 0 25 25" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M19.793 7.29102C19.5167 7.29102 19.2517 7.40076 19.0564 7.59611C18.861 7.79146 18.7513 8.05642 18.7513 8.33268V19.99C18.7214 20.5167 18.4846 21.0103 18.0924 21.3633C17.7003 21.7162 17.1845 21.8999 16.6576 21.8743H8.34505C7.81807 21.8999 7.30233 21.7162 6.91016 21.3633C6.518 21.0103 6.28118 20.5167 6.2513 19.99V8.33268C6.2513 8.05642 6.14156 7.79146 5.9462 7.59611C5.75085 7.40076 5.4859 7.29102 5.20964 7.29102C4.93337 7.29102 4.66842 7.40076 4.47307 7.59611C4.27772 7.79146 4.16797 8.05642 4.16797 8.33268V19.99C4.1977 21.0694 4.65399 22.093 5.43691 22.8367C6.21982 23.5804 7.26554 23.9834 8.34505 23.9577H16.6576C17.7371 23.9834 18.7828 23.5804 19.5657 22.8367C20.3486 22.093 20.8049 21.0694 20.8346 19.99V8.33268C20.8346 8.05642 20.7249 7.79146 20.5295 7.59611C20.3342 7.40076 20.0692 7.29102 19.793 7.29102Z" fill="#ffb4ab"/>
                            <path d="M20.8333 4.16602H16.6667V2.08268C16.6667 1.80642 16.5569 1.54146 16.3616 1.34611C16.1662 1.15076 15.9013 1.04102 15.625 1.04102H9.375C9.09873 1.04102 8.83378 1.15076 8.63843 1.34611C8.44308 1.54146 8.33333 1.80642 8.33333 2.08268V4.16602H4.16667C3.8904 4.16602 3.62545 4.27576 3.4301 4.47111C3.23475 4.66646 3.125 4.93142 3.125 5.20768C3.125 5.48395 3.23475 5.7489 3.4301 5.94425C3.62545 6.1396 3.8904 6.24935 4.16667 6.24935H20.8333C21.1096 6.24935 21.3746 6.1396 21.5699 5.94425C21.7653 5.7489 21.875 5.48395 21.875 5.20768C21.875 4.93142 21.7653 4.66646 21.5699 4.47111C21.3746 4.27576 21.1096 4.16602 20.8333 4.16602ZM10.4167 4.16602V3.12435H14.5833V4.16602H10.4167Z" fill="#ffb4ab"/>
                            <path d="M11.4583 17.7083V10.4167C11.4583 10.1404 11.3486 9.87545 11.1532 9.6801C10.9579 9.48475 10.6929 9.375 10.4167 9.375C10.1404 9.375 9.87545 9.48475 9.6801 9.6801C9.48475 9.87545 9.375 10.1404 9.375 10.4167V17.7083C9.375 17.9846 9.48475 18.2496 9.6801 18.4449C9.87545 18.6403 10.1404 18.75 10.4167 18.75C10.6929 18.75 10.9579 18.6403 11.1532 18.4449C11.3486 18.2496 11.4583 17.9846 11.4583 17.7083Z" fill="#ffb4ab"/>
                            <path d="M15.6263 17.7083V10.4167C15.6263 10.1404 15.5166 9.87545 15.3212 9.6801C15.1259 9.48475 14.8609 9.375 14.5846 9.375C14.3084 9.375 14.0434 9.48475 13.8481 9.6801C13.6527 9.87545 13.543 10.1404 13.543 10.4167V17.7083C13.543 17.9846 13.6527 18.2496 13.8481 18.4449C14.0434 18.6403 14.3084 18.75 14.5846 18.75C14.8609 18.75 15.1259 18.6403 15.3212 18.4449C15.5166 18.2496 15.6263 17.9846 15.6263 17.7083Z" fill="#ffb4ab"/>
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-gray-500 text-sm mb-4">{t('checklist.noAttachments')}</div>
              )}
                  
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    onChange={handleFileSelect}
                    className="hidden"
                    accept={UPLOAD_ACCEPT}
                  />
                  
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading || !leadId}
                    className="flex items-center justify-center py-3 px-4 rounded-lg border border-dashed border-gray-300 cursor-pointer hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed w-full"
                  >
                    {isUploading ? (
                      <>
                        <svg className="animate-spin h-5 w-5 mr-2 text-dream-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>{t('checklist.uploading')}</span>
                      </>
                    ) : (
                      <>
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="mr-2">
                          <path d="M18 3H14C12.6744 3.00156 11.4035 3.52885 10.4662 4.46619C9.52885 5.40353 9.00156 6.6744 9 8V28C9 28.2652 9.10536 28.5196 9.29289 28.7071C9.48043 28.8946 9.73478 29 10 29C10.2652 29 10.5196 28.8946 10.7071 28.7071C10.8946 28.5196 11 28.2652 11 28V8C11.0009 7.20462 11.3172 6.44206 11.8796 5.87964C12.4421 5.31722 13.2046 5.00087 14 5H18C18.7954 5.00087 19.5579 5.31722 20.1204 5.87964C20.6828 6.44206 20.9991 7.20462 21 8V24C21 24.7956 20.6839 25.5587 20.1213 26.1213C19.5587 26.6839 18.7956 27 18 27C17.2044 27 16.4413 26.6839 15.8787 26.1213C15.3161 25.5587 15 24.7956 15 24V11C15 10.7348 15.1054 10.4804 15.2929 10.2929C15.4804 10.1054 15.7348 10 16 10C16.2652 10 16.5196 10.1054 16.7071 10.2929C16.8946 10.4804 17 10.7348 17 11V23C17 23.2652 17.1054 23.5196 17.2929 23.7071C17.4804 23.8946 17.7348 24 18 24C18.2652 24 18.5196 23.8946 18.7071 23.7071C18.8946 23.5196 19 23.2652 19 23V11C19 10.2044 18.6839 9.44129 18.1213 8.87868C17.5587 8.31607 16.7956 8 16 8C15.2044 8 14.4413 8.31607 13.8787 8.87868C13.3161 9.44129 13 10.2044 13 11V24C13 25.3261 13.5268 26.5979 14.4645 27.5355C15.4021 28.4732 16.6739 29 18 29C19.3261 29 20.5979 28.4732 21.5355 27.5355C22.4732 26.5979 23 25.3261 23 24V8C22.9984 6.6744 22.4712 5.40353 21.5338 4.46619C20.5965 3.52885 19.3256 3.00156 18 3Z" fill="currentColor" transform="scale(0.6) translate(3, 3)"/>
                        </svg>
                        <span>{t('checklist.addFile')}</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
      <DeleteConfirmModal
        isOpen={deleteFolderConfirm.isOpen}
        title={t('checklist.deleteFolderTitle')}
        message={deleteFolderConfirm.folder ? formatMessage(t('checklist.deleteFolderMessage'), { name: deleteFolderConfirm.folder.name }) : ''}
        onCancel={() => setDeleteFolderConfirm({ isOpen: false, folder: null })}
        onConfirm={handleDeleteFolderConfirm}
      />
      <DeleteConfirmModal
        isOpen={deleteLeadFileConfirm.isOpen}
        title={t('checklist.deleteFileTitle')}
        message={deleteLeadFileConfirm.filename ? formatMessage(t('checklist.deleteFileMessage'), { name: decodeFilename(deleteLeadFileConfirm.originalName || deleteLeadFileConfirm.filename) }) : ''}
        onCancel={() => setDeleteLeadFileConfirm({ isOpen: false, filename: null })}
        onConfirm={handleDeleteFileConfirm}
      />
      <ToastContainer />
    </div>
  );
};

export default LeadStageChecklist;
