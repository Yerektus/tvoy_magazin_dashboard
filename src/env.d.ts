// Переменные сборки. Читает их `@ngx-env/builder`: в бандл попадают только те,
// что начинаются с `NG_APP_` — так секрет не утечёт в браузер по недосмотру.
declare interface Env {
  readonly NODE_ENV: string;
  /** Адрес API. Пусто — относительный `/api`, когда фронт и API за одним доменом. */
  readonly NG_APP_API_URL: string;
}

declare interface ImportMeta {
  readonly env: Env;
}
