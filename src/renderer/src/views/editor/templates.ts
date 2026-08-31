import type { TranslationKey } from '../../i18n'

/**
 * Starter documents, written as Markdown so one small source produces the
 * headings, tables and lists the editor understands.
 */
export interface DocumentTemplate {
  id: string
  labelKey: TranslationKey
  markdown: string
}

export const TEMPLATES: DocumentTemplate[] = [
  {
    id: 'blank',
    labelKey: 'editor.template.blank',
    markdown: '# عنوان المستند\n\nابدأ الكتابة هنا…\n'
  },
  {
    id: 'letter',
    labelKey: 'editor.template.letter',
    markdown: `# خطاب رسمي

**التاريخ:** ‎—‎
**إلى:** ‎—‎
**الموضوع:** ‎—‎

السلام عليكم ورحمة الله وبركاته،

نفيدكم بأن…

وتفضلوا بقبول فائق الاحترام،

**الاسم:** ‎—‎
**المسمى الوظيفي:** ‎—‎
`
  },
  {
    id: 'report',
    labelKey: 'editor.template.report',
    markdown: `# تقرير

## الملخص التنفيذي

سطر أو سطران يلخصان النتيجة الرئيسية.

## المنهجية

- المصدر الأول
- المصدر الثاني

## النتائج

| البند | القيمة | الملاحظات |
| --- | --- | --- |
|  |  |  |
|  |  |  |

## التوصيات

1. التوصية الأولى
2. التوصية الثانية
`
  },
  {
    id: 'invoice',
    labelKey: 'editor.template.invoice',
    markdown: `# فاتورة

**رقم الفاتورة:** ‎—‎
**التاريخ:** ‎—‎
**العميل:** ‎—‎

| الوصف | الكمية | سعر الوحدة | الإجمالي |
| --- | --- | --- | --- |
|  |  |  |  |
|  |  |  |  |

**المجموع الفرعي:** ‎—‎
**الضريبة:** ‎—‎
**الإجمالي المستحق:** ‎—‎

> شروط الدفع: خلال ٣٠ يوماً من تاريخ الفاتورة.
`
  },
  {
    id: 'resume',
    labelKey: 'editor.template.resume',
    markdown: `# الاسم الكامل

**المسمى المهني** · البريد الإلكتروني · رقم الهاتف · المدينة

## نبذة

سطران يصفان الخبرة والتخصص.

## الخبرة العملية

### المسمى الوظيفي — الشركة
*من — إلى*

- إنجاز أول
- إنجاز ثانٍ

## التعليم

### الدرجة العلمية — الجامعة
*سنة التخرج*

## المهارات

- مهارة
- مهارة
`
  },
  {
    id: 'meeting',
    labelKey: 'editor.template.meeting',
    markdown: `# محضر اجتماع

**التاريخ:** ‎—‎
**الحاضرون:** ‎—‎

## جدول الأعمال

1. البند الأول
2. البند الثاني

## المناقشات

- ‎—‎

## القرارات والمهام

| المهمة | المسؤول | الموعد |
| --- | --- | --- |
|  |  |  |
`
  }
]
