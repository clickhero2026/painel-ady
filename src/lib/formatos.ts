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
