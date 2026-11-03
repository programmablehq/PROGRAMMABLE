type BuildResult = {
  compilation: { compiled: boolean };
  sourceAudit?: { status: "passed" | "changes_required"; findings: ReadonlyArray<{ message: string }> };
  scenarios?: { passed: boolean; cases: number };
};
export const BUILD_REPLY_LOCALES = ["en", "de", "fr", "es", "it", "pt", "nl", "tr"] as const;
export type BuildReplyLocale = typeof BUILD_REPLY_LOCALES[number];
export function buildReplyLocale(value: unknown): BuildReplyLocale {
  return BUILD_REPLY_LOCALES.includes(value as BuildReplyLocale) ? value as BuildReplyLocale : "en";
}

const unfinished: Record<BuildReplyLocale, readonly [string,string]> = {
  en: ["Your design is saved. The checks stopped before the code was ready. Continue below and I’ll pick up the saved work.", "Your design and the code so far are saved. Continue below and I’ll finish from here."],
  de: ["Dein Entwurf ist gespeichert. Die Prüfung ist hängen geblieben, bevor der Code fertig war. Unten kannst du genau hier weitermachen.", "Dein Entwurf und der bisherige Code sind gespeichert. Unten kannst du genau hier weiterbauen."],
  fr: ["Ton projet est enregistré. La vérification s’est arrêtée avant la fin du code. Continue ci-dessous pour reprendre le travail enregistré.", "Ton projet et le code déjà écrit sont enregistrés. Continue ci-dessous pour reprendre ici."],
  es: ["Tu diseño está guardado. La revisión se detuvo antes de terminar el código. Continúa abajo para retomar el trabajo guardado.", "Tu diseño y el código escrito están guardados. Continúa abajo para seguir desde aquí."],
  it: ["Il progetto è salvato. La verifica si è fermata prima che il codice fosse pronto. Continua qui sotto per riprendere il lavoro salvato.", "Il progetto e il codice scritto finora sono salvati. Continua qui sotto per riprendere da qui."],
  pt: ["O teu projeto está guardado. A verificação parou antes de o código estar pronto. Continua abaixo para retomar o trabalho guardado.", "O teu projeto e o código já escrito estão guardados. Continua abaixo para retomar daqui."],
  nl: ["Je ontwerp is opgeslagen. De controle stopte voordat de code klaar was. Ga hieronder verder met het opgeslagen werk.", "Je ontwerp en de bestaande code zijn opgeslagen. Ga hieronder verder waar we gebleven waren."],
  tr: ["Tasarımın kaydedildi. Kod tamamlanmadan kontrol durdu. Kaydedilen çalışmaya aşağıdan devam edebilirsin.", "Tasarımın ve yazılan kod kaydedildi. Aşağıdan kaldığın yerden devam edebilirsin."],
};
const sourceNotStarted: Record<BuildReplyLocale, string> = {
  en: "Your design is saved. The code response did not finish. Continue below to pick up this build.",
  de: "Dein Entwurf ist gespeichert. Die Code-Antwort wurde nicht fertig. Unten kannst du diesen Build fortsetzen.",
  fr: "Ton projet est enregistré. La réponse contenant le code n’a pas abouti. Continue ci-dessous pour reprendre ce projet.",
  es: "Tu diseño está guardado. La respuesta con el código no se completó. Continúa abajo para retomar este proyecto.",
  it: "Il progetto è salvato. La risposta con il codice non è stata completata. Continua qui sotto per riprendere il progetto.",
  pt: "O teu projeto está guardado. A resposta com o código não foi concluída. Continua abaixo para retomar o projeto.",
  nl: "Je ontwerp is opgeslagen. Het antwoord met de code is niet afgerond. Ga hieronder verder met deze build.",
  tr: "Tasarımın kaydedildi. Kod yanıtı tamamlanmadı. Bu derlemeye aşağıdan devam edebilirsin.",
};
export function unfinishedBuildReply(stage:"checks"|"source",locale:unknown,hasSourceProgress=true):string {
  if (stage === "source" && !hasSourceProgress) return sourceNotStarted[buildReplyLocale(locale)];
  return unfinished[buildReplyLocale(locale)][stage==="checks"?0:1];
}
// Translating the presentation never changes the observed result or adds a
// model call. The original finding remains exact when a correction is needed.
const copy: Record<BuildReplyLocale, readonly string[]> = {
  en: ["The source is saved. The independent review found a correction: {finding}", "The source is saved, but it has compiler diagnostics. Ask me to fix this source.", "The source is saved, but a declared contract check failed. Ask me to fix this source.", "Your hook is built and saved. It compiled successfully, the independent source review passed, and all {cases} declared checks passed. No launch transaction has been sent.", "Your source compiled and all {cases} declared checks passed. Independent source review is still required before launch preparation.", "Your source compiled and the independent source review passed. The declared behavior checks are not complete yet.", "Your source compiled and is saved. Independent source review and behavior checks are not complete yet."],
  de: ["Der Quellcode ist gespeichert. Die unabhängige Prüfung hat eine nötige Korrektur gefunden: {finding}", "Der Quellcode ist gespeichert, lässt sich aber noch nicht fehlerfrei kompilieren. Sag mir, dass ich ihn korrigieren soll.", "Der Quellcode ist gespeichert. Eine Verhaltensprüfung ist fehlgeschlagen; die korrigieren wir vor dem Launch.", "Dein Hook ist gebaut und gespeichert. Compiler, unabhängige Quellcodeprüfung und alle {cases} Verhaltensprüfungen sind durch. Es wurde noch keine Launch-Transaktion gesendet.", "Der Quellcode ist kompiliert und alle {cases} Verhaltensprüfungen sind durch. Die unabhängige Quellcodeprüfung steht noch aus.", "Der Quellcode ist kompiliert und unabhängig geprüft. Die Verhaltensprüfungen sind noch nicht abgeschlossen.", "Der Quellcode ist kompiliert und gespeichert. Die unabhängige Quellcodeprüfung und die Verhaltensprüfungen stehen noch aus."],
  fr: ["Le code est enregistré. La vérification indépendante a trouvé une correction à apporter : {finding}", "Le code est enregistré, mais la compilation signale encore une erreur. Demande-moi de la corriger.", "Le code est enregistré, mais un test de comportement a échoué. Il faut le corriger avant le lancement.", "Ton hook est créé et enregistré. La compilation, la vérification indépendante et les {cases} tests de comportement ont réussi. Aucune transaction de lancement n’a été envoyée.", "Le code a été compilé et les {cases} tests ont réussi. La vérification indépendante reste à faire.", "Le code a été compilé et vérifié indépendamment. Les tests de comportement ne sont pas encore terminés.", "Le code a été compilé et enregistré. La vérification indépendante et les tests de comportement restent à faire."],
  es: ["El código está guardado. La revisión independiente encontró una corrección necesaria: {finding}", "El código está guardado, pero el compilador señala un error. Pídeme que lo corrija.", "El código está guardado, pero una prueba de comportamiento falló. Hay que corregirla antes del lanzamiento.", "Tu hook está creado y guardado. La compilación, la revisión independiente y las {cases} pruebas de comportamiento pasaron. No se ha enviado ninguna transacción de lanzamiento.", "El código se compiló y las {cases} pruebas pasaron. Falta la revisión independiente.", "El código se compiló y pasó la revisión independiente. Las pruebas de comportamiento todavía no han terminado.", "El código está compilado y guardado. Faltan la revisión independiente y las pruebas de comportamiento."],
  it: ["Il codice è salvato. La verifica indipendente ha trovato una correzione necessaria: {finding}", "Il codice è salvato, ma il compilatore segnala un errore. Chiedimi di correggerlo.", "Il codice è salvato, ma un test del comportamento non è passato. Va corretto prima del lancio.", "Il tuo hook è creato e salvato. La compilazione, la verifica indipendente e tutti i {cases} test sono passati. Non è stata inviata alcuna transazione di lancio.", "Il codice è compilato e tutti i {cases} test sono passati. Manca la verifica indipendente.", "Il codice è compilato e verificato in modo indipendente. I test del comportamento non sono ancora terminati.", "Il codice è compilato e salvato. Mancano la verifica indipendente e i test del comportamento."],
  pt: ["O código está guardado. A revisão independente encontrou uma correção necessária: {finding}", "O código está guardado, mas o compilador indica um erro. Pede-me para o corrigir.", "O código está guardado, mas um teste de comportamento falhou. É preciso corrigi-lo antes do lançamento.", "O teu hook está criado e guardado. A compilação, a revisão independente e os {cases} testes passaram. Nenhuma transação de lançamento foi enviada.", "O código foi compilado e os {cases} testes passaram. Falta a revisão independente.", "O código foi compilado e revisto de forma independente. Os testes de comportamento ainda não terminaram.", "O código está compilado e guardado. Faltam a revisão independente e os testes de comportamento."],
  nl: ["De code is opgeslagen. De onafhankelijke controle vond een noodzakelijke correctie: {finding}", "De code is opgeslagen, maar de compiler meldt nog een fout. Vraag me die te herstellen.", "De code is opgeslagen, maar een gedragstest is mislukt. Die moet voor de lancering worden hersteld.", "Je hook is gebouwd en opgeslagen. De compilatie, onafhankelijke controle en alle {cases} gedragstests zijn geslaagd. Er is geen lanceringstransactie verzonden.", "De code is gecompileerd en alle {cases} tests zijn geslaagd. De onafhankelijke controle moet nog gebeuren.", "De code is gecompileerd en onafhankelijk gecontroleerd. De gedragstests zijn nog niet afgerond.", "De code is gecompileerd en opgeslagen. De onafhankelijke controle en gedragstests moeten nog gebeuren."],
  tr: ["Kod kaydedildi. Bağımsız inceleme gerekli bir düzeltme buldu: {finding}", "Kod kaydedildi, ancak derleyici bir hata bildiriyor. Benden düzeltmemi isteyebilirsin.", "Kod kaydedildi, ancak bir davranış testi başarısız oldu. Lansmandan önce düzeltilmesi gerekiyor.", "Hook oluşturuldu ve kaydedildi. Derleme, bağımsız inceleme ve {cases} davranış testinin tamamı başarılı. Henüz bir lansman işlemi gönderilmedi.", "Kod derlendi ve {cases} testin tamamı başarılı. Bağımsız inceleme henüz tamamlanmadı.", "Kod derlendi ve bağımsız olarak incelendi. Davranış testleri henüz tamamlanmadı.", "Kod derlendi ve kaydedildi. Bağımsız inceleme ve davranış testleri henüz tamamlanmadı."],
};

/** Completion is reported from persisted check results, never a source model's prediction. */
export function generalBuildReply(value: BuildResult, locale: unknown = "en"): string {
  const stage = value.sourceAudit?.status === "changes_required" ? 0 : !value.compilation.compiled ? 1
    : value.scenarios?.passed === false ? 2 : value.scenarios?.passed && value.sourceAudit?.status === "passed" ? 3
      : value.scenarios?.passed ? 4 : value.sourceAudit?.status === "passed" ? 5 : 6;
  return copy[buildReplyLocale(locale)][stage].replace("{cases}", String(value.scenarios?.cases ?? 0))
    .replace("{finding}", value.sourceAudit?.findings[0]?.message ?? "Update this source before continuing.");
}
