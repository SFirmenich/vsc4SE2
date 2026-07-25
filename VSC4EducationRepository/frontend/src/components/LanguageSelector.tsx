import { locales, t, type Locale } from "../i18n";

export function LanguageSelector(props: { locale: Locale; onChange: (locale: Locale) => void }) {
  return (
    <label className="languageSelect">
      <span>{t("Language")}</span>
      <select value={props.locale} onChange={(event) => props.onChange(event.target.value as Locale)}>
        {locales.map((locale) => (
          <option key={locale.code} value={locale.code}>{locale.label}</option>
        ))}
      </select>
    </label>
  );
}
