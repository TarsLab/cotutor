/** 当前学期仍由档案推算。此函数仅用于 doctor 比对,不选择/切换文件。 */
export function gradeOfSemester(semester: string | null): number | null {
  const match = /^([一二三四五六]|[1-6])年级/.exec(semester ?? '');
  if (!match) return null;
  return /^[1-6]$/.test(match[1]) ? Number(match[1]) : '一二三四五六'.indexOf(match[1]) + 1;
}
