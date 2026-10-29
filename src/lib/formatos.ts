/** Formatação de datas, telefones e nomes para a tela (fuso de São Paulo). */

const FUSO = "America/Sao_Paulo";

const dataHora = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: FUSO });
const soData = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: FUSO });

export function formatarDataHora(data: Date | string | null): string | null {
  return data ? dataHora.format(new Date(data)) : null;
}

export function formatarData(data: Date | string | null): string | null {
  return data ? soData.format(new Date(data)) : null;
}

/** "5585999999999" → "+55 (85) 99999-9999". Fora do padrão, devolve como veio. */
export function formatarWhatsapp(digitos: string): string {
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(digitos);
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : digitos;
}

export function primeiroNome(nome: string | null | undefined): string {
  return nome?.trim().split(/\s+/)[0] ?? "";
}

/** Tempo desde `desde` em palavras: "3 dias", "5 horas", "menos de 1 hora". */
export function tempoDesde(desde: Date | string, agora = Date.now()): string {
  const horas = Math.floor((agora - new Date(desde).getTime()) / 3_600_000);
  if (horas < 1) return "menos de 1 hora";
  if (horas < 48) return `${horas} ${horas === 1 ? "hora" : "horas"}`;
  const dias = Math.floor(horas / 24);
  return `${dias} dias`;
}

/** `data` foi há mais de `dias` dias? */
export function passouDias(data: Date | string, dias: number, agora = Date.now()): boolean {
  return agora - new Date(data).getTime() > dias * 86_400_000;
}

const porcento = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });
const inteiro = new Intl.NumberFormat("pt-BR");

/** 0.4567 → "45,7%". */
export function formatarPercentual(fracao: number): string {
  return porcento.format(fracao);
}

export function formatarNumero(n: number): string {
  return inteiro.format(n);
}

/** Duração em palavras: "12 min", "3 h 20 min", "2 dias e 4 h". */
export function formatarDuracao(segundos: number): string {
  const minutos = Math.max(0, Math.round(segundos / 60));
  if (minutos < 1) return "menos de 1 min";
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 48) {
    const resto = minutos % 60;
    return resto ? `${horas} h ${resto} min` : `${horas} h`;
  }
  const dias = Math.floor(horas / 24);
  const resto = horas % 24;
  return resto ? `${dias} dias e ${resto} h` : `${dias} dias`;
}

/** "2026-10-29" → "29/10" (curta, pros eixos) ou "29/10/2026". */
export function formatarDia(dia: string, curta = false): string {
  const [a, m, d] = dia.split("-");
  return curta ? `${d}/${m}` : `${d}/${m}/${a}`;
}

const pontos = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1, signDisplay: "exceptZero" });

/** Diferença entre frações em pontos percentuais: 0.123 → "+12,3 p.p.". */
export function formatarPontos(fracao: number): string {
  return `${pontos.format(Math.round(fracao * 1000) / 10)} p.p.`;
}

/** `data` já passou? */
export function jaPassou(data: Date | string, agora = Date.now()): boolean {
  return new Date(data).getTime() < agora;
}
