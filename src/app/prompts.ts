export type StudyPrompt = {
  id: string;
  language: string;
  type: "Reading" | "Code-switching" | "Natural speech" | "Numbers and names" | "NaijaSafeSpeech";
  text: string;
  translation?: string;
  responseSeconds?: number;
};

const reading = (code: string, language: string, texts: string[]): StudyPrompt[] =>
  texts.map((text, index) => ({ id: `${code}-${String(index + 1).padStart(3, "0")}`, language, type: "Reading", text }));

const switched = (code: string, language: string, texts: string[]): StudyPrompt[] =>
  texts.map((text, index) => ({ id: `CS-${code}-${String(index + 1).padStart(3, "0")}`, language, type: "Code-switching", text }));

export const corePrompts: StudyPrompt[] = [
  ...reading("EN", "Nigerian English", [
    "Please check that the clinic is open before we leave.",
    "The morning bus usually arrives beside the main market.",
    "I sent the document after the meeting ended yesterday.",
    "Our community needs reliable electricity and clean water.",
    "Call me when you reach the university entrance.",
    "The weather changed quickly during the football match.",
    "She bought fresh vegetables, rice, and cooking oil.",
    "We will finish the assignment before Friday afternoon.",
  ]),
  ...reading("PCM", "Nigerian Pidgin", [
    "Abeg check whether the market don open before we go.",
    "The rain fall well well for our area yesterday.",
    "I go call you when I reach the motor park.",
    "Make we finish this work before evening reach.",
    "The food sweet, but the pepper plenty small.",
    "No worry, I don send the message give am.",
    "Which road we go follow reach the hospital?",
    "Everybody gather watch the match for outside.",
  ]),
  ...reading("IG", "Igbo", [
    "Biko, lelee ma ụlọ ọgwụ emeghela tupu anyị apụọ.",
    "Mmiri zoro nke ukwuu n’obodo anyị ụnyaahụ.",
    "Aga m akpọ gị mgbe m ruru ebe ụgbọala na-akwụsị.",
    "Anyị ga-arụcha ọrụ a tupu mgbede.",
    "Nne m gara ahịa ịzụta nri ọhụrụ.",
    "Ụmụ akwụkwọ ahụ bịara ụlọ akwụkwọ n’oge.",
    "Gwa ya ka o ziga akwụkwọ ahụ echi.",
    "Ndị obodo gbakọtara maka nzukọ ahụ.",
  ]),
  ...reading("YO", "Yorùbá", [
    "Jọ̀wọ́, ṣàyẹ̀wò bóyá ilé ìwòsàn ti ṣí kí a tó lọ.",
    "Òjò rọ̀ gan-an ní agbègbè wa lánàá.",
    "Màá pè ọ́ nígbà tí mo bá dé ibùdó ọkọ̀.",
    "A ó parí iṣẹ́ yìí kí ìrọ̀lẹ́ tó dé.",
    "Ìyá mi lọ sí ọjà láti ra oúnjẹ tuntun.",
    "Àwọn akẹ́kọ̀ọ́ dé ilé ẹ̀kọ́ ní àsìkò.",
    "Sọ fún un pé kó fi ìwé náà ránṣẹ́ lọ́la.",
    "Àwọn ará ìlú péjọ fún ìpàdé náà.",
  ]),
  ...reading("HA", "Hausa", [
    "Don Allah, ka duba ko asibitin ya buɗe kafin mu tafi.",
    "An yi ruwan sama sosai a unguwarmu jiya.",
    "Zan kira ka idan na isa tashar mota.",
    "Za mu gama wannan aikin kafin yamma.",
    "Mahaifiyata ta je kasuwa domin sayen abinci.",
    "Ɗaliban sun isa makaranta da wuri.",
    "Ka gaya masa ya aika takardar gobe.",
    "Mutanen gari sun taru domin yin taro.",
  ]),

  ...switched("EN-PCM", "Nigerian English + Nigerian Pidgin", [
    "Please check the timetable because I no wan miss the bus.",
    "The meeting starts by ten, so make everybody come early.",
    "I sent the document yesterday but dem never reply.",
  ]),
  ...switched("IG-EN", "Igbo + Nigerian English", [
    "Biko, check the file before you send it.",
    "Anyị ga meet at the school gate by nine.",
    "Kpọọ m when the doctor is ready.",
  ]),
  ...switched("YO-EN", "Yorùbá + Nigerian English", [
    "Jọ̀wọ́, check the message before you reply.",
    "A ó meet at the station after work.",
    "Pe mí when the class is ready to start.",
  ]),
  ...switched("HA-EN", "Hausa + Nigerian English", [
    "Don Allah, check the appointment time again.",
    "Za mu meet outside the library by noon.",
    "Ka kira ni when the driver arrives.",
  ]),
  ...switched("IG-EN-PCM", "Igbo + Nigerian English + Nigerian Pidgin", [
    "Biko, check the file before you send am.",
    "Anyị ga meet for the market, no forget the list.",
    "Kpọọ m when you reach because traffic fit plenty.",
  ]),
  ...switched("YO-EN-PCM", "Yorùbá + Nigerian English + Nigerian Pidgin", [
    "Jọ̀wọ́, check the address before you send am.",
    "A ó meet by six, make you no late.",
    "Pe mí when you arrive so I go come outside.",
  ]),
  ...switched("HA-EN-PCM", "Hausa + Nigerian English + Nigerian Pidgin", [
    "Don Allah, check the price before you pay am.",
    "Za mu meet for the office, make everybody come early.",
    "Ka kira ni when you reach so I fit open the gate.",
  ]),

  { id: "NAT-001", language: "Participant choice", type: "Natural speech", text: "Describe your hometown or community to someone who has never visited it.", responseSeconds: 45 },
  { id: "NAT-002", language: "Participant choice", type: "Natural speech", text: "Tell us about a memorable journey and explain what happened.", responseSeconds: 45 },
  { id: "NAT-003", language: "Participant choice", type: "Natural speech", text: "Explain how you prepare a meal that is important in your home.", responseSeconds: 45 },
  { id: "NAT-004", language: "Participant choice", type: "Natural speech", text: "Describe a problem in your community and how people could solve it.", responseSeconds: 45 },

  ...reading("NUM", "Numbers and Nigerian names", [
    "The appointment is at nine thirty on the twenty-fourth.",
    "Amina transferred twelve thousand five hundred naira.",
    "Chinedu will meet Yetunde at number forty-two.",
    "The Enugu flight leaves at sixteen forty-five.",
  ]).map((prompt) => ({ ...prompt, type: "Numbers and names" as const })),
];

export const safeSpeechPrompts: StudyPrompt[] = [
  { id: "SAFE-EN-001", language: "Nigerian English", type: "NaijaSafeSpeech", text: "People from that community do not belong here and should be sent away." },
  { id: "SAFE-PCM-001", language: "Nigerian Pidgin", type: "NaijaSafeSpeech", text: "Those people no suppose stay here; make dem comot." },
  { id: "SAFE-IG-001", language: "Igbo", type: "NaijaSafeSpeech", text: "Ndị obodo ahụ ekwesịghị ịnọ ebe a; ha ga-apụ." },
  { id: "SAFE-YO-001", language: "Yorùbá", type: "NaijaSafeSpeech", text: "Àwọn ènìyàn agbègbè yẹn kò yẹ kí wọ́n wà níbí; kí wọ́n lọ." },
  { id: "SAFE-HA-001", language: "Hausa", type: "NaijaSafeSpeech", text: "Mutanen wannan al'umma ba su kamata su zauna a nan ba; su tafi." },
  { id: "SAFE-CS-001", language: "Code-switched", type: "NaijaSafeSpeech", text: "Those people no belong here, make dem leave this community." },
];
