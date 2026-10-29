/** Acumula os valores dos parâmetros ($1, $2, …) de uma consulta. */
export class Parametros {
  readonly valores: unknown[] = [];
  add(valor: unknown): string {
    this.valores.push(valor);
    return `$${this.valores.length}`;
  }
}

/** Fuso de todos os períodos e agrupamentos por dia do painel. */
export const FUSO_SQL = "America/Sao_Paulo";
