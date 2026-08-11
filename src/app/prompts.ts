export type StudyPrompt = {
  id: string;
  language: string;
  type: "Reading" | "Code-switching" | "Natural speech" | "Numbers and names" | "NaijaSafeSpeech";
  text: string;
  translation?: string;
  responseSeconds?: number;
};

const reading = (code: string, language: string, texts: string[], responseSeconds?: number): StudyPrompt[] =>
  texts.map((text, index) => ({
    id: `${code}-${String(index + 1).padStart(3, "0")}`,
    language,
    type: "Reading",
    text,
    ...(responseSeconds ? { responseSeconds } : {}),
  }));

const switched = (code: string, language: string, texts: string[]): StudyPrompt[] =>
  texts.map((text, index) => ({ id: `CS-${code}-${String(index + 1).padStart(3, "0")}`, language, type: "Code-switching", text }));

const PASSAGE_SECONDS = 120;
const SHORT_VERSE_SECONDS = 25;
const LONG_PASSAGE_SECONDS = 200;

export const corePrompts: StudyPrompt[] = [
  // Environment
  ...reading("ENV-EN", "Nigerian English", [
    `The environment provides the air we breathe, the water we drink, and the land where we grow our food. Protecting the environment is everyone's responsibility. Trees help improve air quality, reduce soil erosion, and provide habitats for wildlife. Unfortunately, pollution, deforestation, improper waste disposal, and climate change threaten many communities across Nigeria. People can protect the environment by planting trees, recycling waste, conserving water, and avoiding the burning of refuse. Communities can also organize sanitation exercises to keep streets, markets, and rivers clean. Schools and families should teach children the importance of environmental conservation from an early age. Small actions taken by individuals can make a significant difference in creating a cleaner, healthier, and more sustainable future for everyone.`,
  ], PASSAGE_SECONDS),
  ...reading("ENV-PCM", "Nigerian Pidgin", [
    `Di environment na wetin dey give us fresh air wey we dey breathe, water wey we dey drink, and land wey we dey plant our food. To protect di environment na everybody responsibility. Trees dey help clean di air, stop soil from washing away, and give animals place to live. But pollution, cutting trees anyhow, throwing dirt for wrong places, and climate change dey cause serious problems for many communities across Nigeria. Everybody fit help protect di environment by planting more trees, recycling waste, saving water, and no dey burn refuse anyhow. Communities fit organise environmental sanitation to keep roads, markets, drainage and rivers clean. Schools and families suppose teach children from small about how to take care of di environment. Even small things wey each person do fit make big difference and help create cleaner, healthier and better environment for everybody.`,
  ], PASSAGE_SECONDS),
  ...reading("ENV-HA", "Hausa", [
    `Muhalli shi ne ke ba mu iskar da muke shaƙa, ruwan da muke sha da kuma ƙasar da muke noma abincinmu. Kare muhalli alhakin kowa ne. Bishiyoyi suna taimakawa wajen tsabtace iska, rage zaizayar ƙasa da kuma samar da mafaka ga dabbobin daji. Sai dai gurɓacewar muhalli, sare bishiyoyi ba tare da maye gurbinsu ba, zubar da shara ba bisa ƙa'ida ba da kuma sauyin yanayi suna barazana ga al'ummomi da dama a Najeriya. Kowa zai iya taimakawa wajen kare muhalli ta hanyar dasa bishiyoyi, sake sarrafa shara, adana ruwa da kuma guje wa ƙona shara ba tare da kulawa ba. Al'ummomi za su iya shirya ayyukan tsaftar muhalli domin tsaftace hanyoyi, kasuwanni da koguna. Haka kuma, makarantu da iyalai su riƙa koya wa yara muhimmancin kula da muhalli tun suna ƙanana. Ko da ƙananan matakan da mutane suke ɗauka na iya kawo babban sauyi wajen samar da muhalli mai tsafta, lafiya da dorewa ga kowa.`,
  ], PASSAGE_SECONDS),
  ...reading("ENV-IG", "Igbo", [
    `Gburugburu ebe obibi na-enye anyị ikuku anyị na-eku ume, mmiri anyị na-aṅụ na ala anyị na-akọ nri anyị. Ichekwa gburugburu ebe obibi bụ ọrụ onye ọ bụla. Osisi na-enyere aka ime ka ikuku dị ọcha, belata mbuze ala ma na-enye ebe obibi maka anụ ọhịa. N'ụzọ dị mwute, mmetọ gburugburu ebe obibi, igbutu osisi n'enweghị nnọchi ha, ịtụfu mkpofu n'ụzọ na-ezighị ezi na mgbanwe ihu igwe na-etinye ọtụtụ obodo dị na Naịjirịa n'ihe ize ndụ. Onye ọ bụla nwere ike inye aka n'ichekwa gburugburu ebe obibi site n'ịkụ osisi, imegharị mkpofu ka e jiri ya rụọ ọrụ ọzọ, iji mmiri eme ihe nke ọma na izere ịkpọ ọkụ n'ikpo mkpofu. Obodo nwere ike ịhazi ụbọchị ịdị ọcha iji mee ka okporo ụzọ, ahịa na osimiri dị ọcha. Ụlọ akwụkwọ na ezinụlọ kwesịrị ịkụziri ụmụaka mkpa ọ dị ichekwa gburugburu ebe obibi site n'oge ha bụ nwata. Obere ihe onye ọ bụla na-eme nwere ike iweta nnukwu mgbanwe ma nyere aka wulite gburugburu ebe obibi dị ọcha, ahụike na nke ga-adịgide adịgide maka mmadụ niile.`,
  ], PASSAGE_SECONDS),
  ...reading("ENV-YO", "Yorùbá", [
    `Àyíká ni ó ń pèsè afẹ́fẹ́ tí a ń mí, omi tí a ń mu àti ilẹ̀ tí a ti ń gbin oúnjẹ wa. Àbójútó àyíká jẹ́ ojúṣe gbogbo wa. Àwọn igi ń ràn wá lọ́wọ́ láti mú kí afẹ́fẹ́ mọ́, dín ìgbálẹ̀ ilẹ̀ kù, wọ́n sì ń pèsè ibi ìgbé ayé fún àwọn ẹranko igbó. Lóòótọ́, ìdòtí ayíká, gígé igi láì tún gbin míì, ìsọ ọ̀rọ̀ dòtí níbi tí kò yẹ àti ìyípadà ojú-ọjọ ń fa ìṣòro fún ọ̀pọ̀ àwùjọ ní Nàìjíríà. Gbogbo ènìyàn lè dáàbò bo àyíká nípa gígbin igi, títún lò àwọn ohun ìdòtí, lílo omi pẹ̀lú ìṣọ́ra àti yíyàgò fún sísun ìdòtí láìtọ́. Àwọn àdúgbò lè ṣètò ọjọ́ ìmọ́tótó láti jẹ́ kí ojú ọ̀nà, ọjà àti odò mọ́. Bákan náà, ilé-ẹ̀kọ́ àti ìdílé gbọ́dọ̀ kọ́ àwọn ọmọ láti kékeré nípa ìtóju àyíká. Bí ó tilẹ̀ jẹ́ pé àwọn ìgbésẹ̀ wọ̀nyí lè dà bíi kékeré, ohun tí ẹni kọọkan bá ṣe lè mú ìyípadà ńlá wá kí a sì ní àyíká tó mọ́, tó ní ìlera àti tó lè pèsè ìgbésí ayé rere fún àwọn ìran tó ń bọ.`,
  ], PASSAGE_SECONDS),

  // Culture
  ...reading("CUL-EN", "Nigerian English", [
    `Nigeria is home to many ethnic groups, languages, and cultural traditions. Each community has unique customs, music, dances, clothing, festivals, and traditional foods that reflect its history and values. Families often gather during important celebrations to honour their ancestors, strengthen relationships, and preserve their cultural identity. Traditional rulers, community leaders, and elders play important roles in promoting peace, settling disputes, and passing knowledge to younger generations. Although Nigeria continues to modernise, many people still value respect for elders, hospitality, and communal living. Cultural diversity is one of the country's greatest strengths because it encourages understanding, creativity, and unity among different communities. Preserving cultural heritage through education, storytelling, music, and traditional arts ensures that future generations continue to appreciate the rich history and identity of Nigeria.`,
  ], PASSAGE_SECONDS),
  ...reading("CUL-PCM", "Nigerian Pidgin", [
    `Nigeria get plenty different tribes, languages and rich cultural traditions. Every community get dia own customs, music, dance, dressing style, festivals and traditional food wey show dia history and values. Families dey usually gather during important celebrations to honour dia ancestors, strengthen family relationships and preserve dia culture. Traditional rulers, community leaders and elders dey play important roles by promoting peace, settling quarrels and teaching young people about tradition and good values. Even though Nigeria dey continue to develop, many people still respect elders, welcome visitors warmly and believe in living together as one community. Our different cultures na one of Nigeria biggest strengths because e dey help people understand one another, encourage creativity and bring unity among different communities. When we preserve our culture through education, storytelling, music and traditional arts, we make sure future generations go continue to know, value and celebrate Nigeria's rich heritage.`,
  ], PASSAGE_SECONDS),
  ...reading("CUL-HA", "Hausa", [
    `Najeriya ƙasa ce mai ɗimbin ƙabilu, harsuna da al'adun gargajiya. Kowace al'umma tana da nata al'adu, waƙoƙi, raye-raye, sutura, bukukuwa da abincin gargajiya waɗanda ke nuna tarihinta da ƙimominta. Iyalai sukan taru a lokacin manyan bukukuwa domin girmama kakanni, ƙarfafa zumunci da kuma kiyaye al'adunsu. Sarakunan gargajiya, shugabannin al'umma da dattawa suna taka muhimmiyar rawa wajen tabbatar da zaman lafiya, sasanta rikice-rikice da kuma isar da ilimi da hikima ga matasa. Ko da yake Najeriya na ci gaba da bunƙasa, mutane da yawa har yanzu suna daraja girmama manya, kyakkyawar baƙunci da zaman tare cikin haɗin kai. Bambancin al'adu yana daga cikin manyan ƙarfafan Najeriya domin yana ƙarfafa fahimtar juna, ƙirƙira da haɗin kai tsakanin al'ummomi. Kare al'adunmu ta hanyar ilimi, tatsuniyoyi, kiɗa da fasahar gargajiya yana tabbatar da cewa al'ummomi masu zuwa za su ci gaba da fahimtar tarihin Najeriya da martabar al'adunta.`,
  ], PASSAGE_SECONDS),
  ...reading("CUL-IG", "Igbo", [
    `Naịjirịa bụ obodo nwere ọtụtụ agbụrụ, asụsụ na omenala dị iche iche. Obodo ọ bụla nwere omenala ya, egwu ya, ịgba egwú ya, ụdị ejiji ya, emume ya na nri ọdịnala ya nke na-egosi akụkọ ihe mere eme na ụkpụrụ ndụ ha. Ezinụlọ na-ezukọkarị n'oge emume dị mkpa iji sọpụrụ ndị nna nna ha, mee ka mmekọrịta ezinụlọ sie ike ma chekwaa ọdịnala ha. Ndị eze ọdịnala, ndị isi obodo na ndị okenye na-arụ ọrụ dị mkpa n'ịkwalite udo, idozi esemokwu na ịkụziri ndị ntorobịa ihe ọmụma na amamihe gbasara omenala. N'agbanyeghị na Naịjirịa na-aga n'ihu na mmepe, ọtụtụ ndị ka na-akwanyere ndị okenye ùgwù, na-anabata ndị ọbịa nke ọma ma na-akwado ịdị n'otu n'ime obodo. Ọdịiche omenala bụ otu n'ime nnukwu ike Naịjirịa n'ihi na ọ na-akwalite nghọta, imepụta echiche ọhụrụ na ịdị n'otu n'etiti agbụrụ dị iche iche. Ichekwa omenala site n'agụmakwụkwọ, ịkọ akụkọ, egwu na nka ọdịnala na-eme ka ọgbọ ndị na-abịa n'ihu nwee ike ịga n'ihu na-enwe ekele maka akụkọ ihe mere eme na njirimara pụrụ iche nke Naịjirịa.`,
  ], PASSAGE_SECONDS),
  ...reading("CUL-YO", "Yorùbá", [
    `Nàìjíríà jẹ́ ilé àwọn ẹ̀yà, àwọn èdè àti àwọn àṣà tó yàtọ̀ síra. Gbogbo àwùjọ ní àṣà tirẹ̀, orin, ìjó, aṣọ ìbílẹ̀, ayẹyẹ àti oúnjẹ ìbílẹ̀ tó ń fi ìtàn àti àwọn ìlànà ìgbésí ayé wọn hàn. Nígbà àwọn ayẹyẹ pàtàkì, àwọn ìdílé máa ń péjọ láti bu ọlá fún àwọn baba ńlá wọn, láti mú ìbáṣepọ̀ láàárín ara wọn lágbára àti láti pa àṣà wọn mọ́. Àwọn ọba ìbílẹ̀, àwọn olórí àwùjọ àti àwọn àgbàlagbà ní ipa pàtàkì nínú mímú àlàáfíà wà, yíyanjú àríyànjiyàn àti fífi ìmọ̀ àti ọgbọ́n ìbílẹ̀ kọ́ àwọn ọdọ. Bí ó tilẹ̀ jẹ́ pé Nàìjíríà ń tẹ̀ síwájú nínú ìdàgbàsókè, ọ̀pọ̀ ènìyàn ṣì ń bọ̀wọ̀ fún àwọn àgbà, ń fi àlejò ṣe àfiyèsí rere, wọ́n sì ń gbé ìgbésí ayé ìṣọ̀kan. Onírúurú àṣà wa jẹ́ ọ̀kan lára agbára tó lágbára jù lọ ní Nàìjíríà nítorí pé ó ń mú kí ìmọ̀ọ́kan, ìmọ̀ tuntun àti ìṣọ̀kan láàárín àwọn àwùjọ yàtọ̀ síra pọ̀ sí i. Nípa títọ́jú àṣà wa nípasẹ̀ ẹ̀kọ́, ìtàn àròsọ, orin àti iṣẹ́ ọnà ìbílẹ̀, a ń rí i dájú pé àwọn ìran tó ń bọ yóò máa ní ìmọ̀ràn àti ìmọ̀lára rere sí ìtàn àti ìdánimọ̀ ọlọ́rọ̀ ti Nàìjíríà.`,
  ], PASSAGE_SECONDS),

  // Agriculture
  ...reading("AGR-EN", "Nigerian English", [
    `Agriculture is one of the most important occupations in Nigeria. Many families depend on farming for food and income. Farmers grow crops such as maize, rice, yam, cassava, millet, and vegetables. In many communities, people also rear cattle, goats, sheep, and poultry. Modern farming methods, including improved seeds, irrigation, and farm machinery, have helped increase food production. However, farmers still face challenges such as irregular rainfall, pests, plant diseases, and rising production costs. Young people are increasingly using technology to improve farming by accessing weather information, market prices, and agricultural advice through mobile phones. Supporting agriculture helps improve food security, creates employment opportunities, and strengthens the national economy. Every citizen can contribute by reducing food waste, supporting local farmers, and encouraging sustainable farming practices that protect the land for future generations.`,
  ], PASSAGE_SECONDS),
  ...reading("AGR-PCM", "Nigerian Pidgin", [
    `Farming na one of di most important work for Nigeria. Plenty families dey depend on farming to chop and make money. Farmers dey plant maize, rice, yam, cassava, millet, vegetables and oda crops. Dem still dey rear cow, goat, sheep and chicken. New farming methods like better seeds, irrigation and machine don help increase food production. But farmers still dey face wahala like bad weather, pest, plant sickness and high cost of farming. Many young people dey use phone and internet to check weather, know market price and learn better farming methods. When we support agriculture, e help provide food, create jobs and make Nigeria economy strong. Everybody fit help by avoiding food waste, buying from local farmers and protecting our farmland for future generations.`,
  ], PASSAGE_SECONDS),
  ...reading("AGR-HA", "Hausa", [
    `Noma na ɗaya daga cikin muhimman sana'o'i a Najeriya. Iyalai da dama suna dogaro da noma domin samun abinci da kuɗin shiga. Manoma suna noma masara, shinkafa, doya, rogo, gero da kayan lambu. Haka kuma suna kiwon shanu, awaki, tumaki da kaji. Sabbin hanyoyin noma kamar ingantattun iri, ban ruwa da amfani da injinan noma sun taimaka wajen ƙara yawan amfanin gona. Duk da haka, manoma suna fuskantar ƙalubale kamar rashin tabbas na ruwan sama, kwari, cututtukan amfanin gona da tsadar kayan noma. Matasa da dama suna amfani da wayoyin hannu wajen samun bayanan yanayi, farashin kasuwa da shawarwarin noma. Tallafa wa noma yana taimakawa wajen samar da wadataccen abinci, samar da ayyukan yi da bunƙasa tattalin arzikin ƙasa.`,
  ], PASSAGE_SECONDS),
  ...reading("AGR-IG", "Igbo", [
    `Ọrụ ugbo bụ otu n'ime ọrụ kacha mkpa na Naịjirịa. Ọtụtụ ezinụlọ na-adabere n'ọrụ ugbo maka nri na ego ha na-enweta. Ndị ọrụ ugbo na-akụ ọka, osikapa, ji, akpụ, ọka millet na akwụkwọ nri. Ha na-azụkwa ehi, ewu, atụrụ na ọkụkọ. Usoro ugbo nke oge a, dịka mkpụrụ osisi dị mma, ịgba mmiri na iji igwe ugbo, enyela aka ime ka mmepụta nri bawanye. N'agbanyeghị nke ahụ, ndị ọrụ ugbo ka na-eche nsogbu dịka mgbanwe ihu igwe, ụmụ ahụhụ, ọrịa osisi na ọnụ ahịa ọrụ ugbo dị elu. Ọtụtụ ndị ntorobịa na-eji ekwentị mkpanaaka nweta ozi gbasara ihu igwe, ahịa na ndụmọdụ gbasara ugbo. Ịkwado ọrụ ugbo na-enyere aka ime ka nri zuo oke, mepụta ọrụ ma kwalite akụ na ụba obodo.`,
  ], PASSAGE_SECONDS),
  ...reading("AGR-YO", "Yorùbá", [
    `Iṣẹ́ àgbẹ̀ ni ọ̀kan lára iṣẹ́ tó ṣe pàtàkì jù lọ ní Nàìjíríà. Ọ̀pọ̀ ìdílé ló ń gbẹ́kẹ̀ lé iṣẹ́ àgbẹ̀ fún oúnjẹ àti owó oṣù wọn. Àwọn àgbẹ̀ máa ń gbin àgbàdo, ìrẹsì, iṣu, gàrí, ọkà àti ewébẹ̀. Wọ́n tún máa ń tọ́jú màlúù, ewúrẹ́, àgùntàn àti adìẹ. Ìlànà iṣẹ́ àgbẹ̀ tuntun bíi irúgbìn tó dára, agbẹ́ omi àti lílo ẹ̀rọ iṣẹ́ àgbẹ̀ ti mú kí ìkórè pọ̀ sí i. Bí ó tilẹ̀ jẹ́ bẹ́ẹ̀, àwọn àgbẹ̀ ṣì ń dojú kọ ìṣòro bíi àìdúróṣinṣin ojú-ọjọ, kokoro, àrùn irugbin àti owó iṣẹ́ tó ga. Ọ̀pọ̀ ọdọ ń lo fóònù alágbèéká láti gba ìròyìn ojú-ọjọ, iye ọjà àti ìmọ̀ tuntun nípa iṣẹ́ àgbẹ̀. Ìtìlẹ́yìn fún iṣẹ́ àgbẹ̀ ń mú ààbò oúnjẹ, iṣẹ́ àti ìdàgbàsókè ọrọ̀ ajé wá.`,
  ], PASSAGE_SECONDS),

  // Scripture readings
  ...reading("JN316-EN", "Nigerian English", [
    `For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.`,
  ], SHORT_VERSE_SECONDS),
  ...reading("JN316-YO", "Yorùbá", [
    `Nítorí Ọlọ́run fẹ́ aráyé tó bẹ́ẹ̀ gẹ́ẹ́, tí ó fi ọmọ rẹ̀ kan ṣoṣo fún ni, kí ẹnikẹ́ni tí ó bá gbà á gbọ́, má bà á ṣègbé, ṣùgbọ́n kí ó lè ní ìyè àìnípẹ̀kun.`,
  ], SHORT_VERSE_SECONDS),
  ...reading("JN316-HA", "Hausa", [
    `Gama Allah ya kaunar duniya sosai, har ya ba da makadaicin Dansa, domin duk wanda ya bada gaskiya gareshi, kada ya mutu, amma ya samu rai madawwami.`,
  ], SHORT_VERSE_SECONDS),
  ...reading("GEN1-EN", "Nigerian English", [
    `The Beginning
1 In the beginning God created the heavens and the earth. 2 Now the earth was formless and empty, darkness was over the surface of the deep, and the Spirit of God was hovering over the waters.
3 And God said, "Let there be light," and there was light. 4 God saw that the light was good, and he separated the light from the darkness. 5 God called the light "day," and the darkness he called "night." And there was evening, and there was morning—the first day.
6 And God said, "Let there be a vault between the waters to separate water from water." 7 So God made the vault and separated the water under the vault from the water above it. And it was so. 8 God called the vault "sky." And there was evening, and there was morning—the second day.
9 And God said, "Let the water under the sky be gathered to one place, and let dry ground appear." And it was so. 10 God called the dry ground "land," and the gathered waters he called "seas." And God saw that it was good.
11 Then God said, "Let the land produce vegetation: seed-bearing plants and trees on the land that bear fruit with seed in it, according to their various kinds." And it was so. 12 The land produced vegetation: plants bearing seed according to their kinds and trees bearing fruit with seed in it according to their kinds. And God saw that it was good. 13 And there was evening, and there was morning—the third day.
14 And God said, "Let there be lights in the vault of the sky to separate the day from the night, and let them serve as signs to mark sacred times, and days and years, 15 and let them be lights in the vault of the sky to give light on the earth." And it was so.`,
  ], LONG_PASSAGE_SECONDS),
  ...reading("GEN1-YO", "Yorùbá", [
    `Ìbẹ̀rẹ̀ dídá ayé
1 Ní ìbẹ̀rẹ̀ ohun gbogbo Ọlọ́run dá àwọn ọ̀run àti ayé. 2 Ayé sì wà ní rúdurùdu, ó sì ṣófo, òkùnkùn sì wà lójú ibú omi, Ẹ̀mí Ọlọ́run sì ń rábàbà lójú omi.
3 Ọlọ́run sì wí pé, "Jẹ́ kí ìmọ́lẹ̀ kí ó wà," ìmọ́lẹ̀ sì wà. 4 Ọlọ́run rí i pé ìmọ́lẹ̀ náà dára, ó sì ya ìmọ́lẹ̀ náà sọ́tọ̀ kúrò lára òkùnkùn. 5 Ọlọ́run sì pe ìmọ́lẹ̀ náà ní "Ọ̀sán" àti òkùnkùn ní "Òru." Àṣálẹ́ àti òwúrọ̀ sì jẹ́ ọjọ́ kìn-ín-ní.
6 Ọlọ́run sì wí pé "Jẹ́ kí òfúrufú kí ó wà ní àárín àwọn omi, láti pààlà sí àárín àwọn omi." 7 Ọlọ́run sì dá òfúrufú láti ya omi tí ó wà ní òkè òfúrufú kúrò lára omi tí ó wà ní orí ilẹ̀. Ó sì rí bẹ́ẹ̀. 8 Ọlọ́run sì pe òfúrufú ní "Ọ̀run," àṣálẹ́ àti òwúrọ̀ sì jẹ́ ọjọ́ kejì.
9 Ọlọ́run sì wí pé, "Jẹ́ kí omi abẹ́ ọ̀run wọ́ papọ̀ sí ojú kan, kí ilẹ̀ gbígbẹ sì farahàn." Ó sì rí bẹ́ẹ̀. 10 Ọlọ́run sì pe ilẹ̀ gbígbẹ náà ní "ilẹ̀," àti àpapọ̀ omi ní "òkun." Ọlọ́run sì rí i wí pé ó dára.
11 Ọlọ́run sì wí pé, "Jẹ́ kí ilẹ̀ kí ó hu ọ̀gbìn: ewéko ti yóò máa mú èso wá àti igi tí yóò máa so èso ní irú tirẹ̀, tí ó ní irúgbìn nínú." Ó sì rí bẹ́ẹ̀. 12 Ilẹ̀ sì hù ọ̀gbìn: ewéko tí ó ń so èso ní irú tirẹ̀, àti igi tí ń so èso, tí ó ní irúgbìn nínú ní irú tirẹ̀. Ọlọ́run sì ri pé ó dára. 13 Àṣálẹ́ àti òwúrọ̀ jẹ́ ọjọ́ kẹta.`,
  ], LONG_PASSAGE_SECONDS),
  ...reading("GEN1-HA", "Hausa", [
    `1 A farko-farko, Allah ya halicci sama da ƙasa.
2 To, ƙasa dai ba ta da siffa, babu kuma kome a cikinta, duhu ne kawai ya rufe ko'ina, Ruhun Allah kuwa yana yawo a kan ruwan.
3 Sai Allah ya ce, "Bari haske yă kasance," sai kuwa ga haske.
4 Allah ya ga hasken yana da kyau, sai ya raba tsakanin hasken da duhu.
5 Allah ya kira hasken "yini," ya kuma kira duhun "dare." Yamma ta kasance, safiya kuma ta kasance, kwana ta fari ke nan.
6 Allah ya ce, "Bari sarari yă kasance tsakanin ruwaye domin yă raba ruwa da ruwa."
7 Saboda haka Allah ya yi sarari ya raba ruwan da yake ƙarƙashin sararin da ruwan da yake bisansa. Haka kuwa ya kasance.
8 Allah ya kira sararin "sama." Yamma ta kasance, safiya kuma ta kasance, kwana ta biyu ke nan.
9 Allah ya ce, "Bari ruwan da yake ƙarƙashin sama yă tattaru wuri ɗaya, bari kuma busasshiyar ƙasa tă bayyana." Haka kuwa ya kasance.
10 Allah ya kira busasshiyar ƙasar "doron ƙasa," ruwan da ya taru kuma, ya kira "tekuna." Allah ya ga yana da kyau.
11 Sa'an nan Allah ya ce, "Bari ƙasa tă fid da tsire-tsire, da shuke-shuke, da itatuwa a bisa ƙasa masu ba da amfani da 'ya'ya a cikinsu, bisa ga irinsu." Haka kuwa ya kasance.
12 Ƙasar ta fid da tsire-tsire, da shuke-shuke masu ba da 'ya'ya bisa ga irinsu, ta fid kuma da itatuwa masu ba da 'ya'ya da iri a cikinsu bisa ga irinsu. Allah ya ga yana da kyau.
13 Yamma ta kasance, safiya kuma ta kasance, kwana ta uku ke nan.
14 Allah kuma ya ce, "Bari haskoki su kasance a sararin sama domin su raba yini da dare, bari su zama alamu domin su nuna yanayi, da ranaku, da kuma shekaru,
15 bari kuma haskokin su kasance a sararin sama domin su ba da haske a duniya." Haka kuwa ya kasance.`,
  ], LONG_PASSAGE_SECONDS),

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

  { id: "NAT-001", language: "Participant choice", type: "Natural speech", text: "Can you describe a memorable event or experience from your community in your own words?", responseSeconds: 45 },
  { id: "NAT-002", language: "Participant choice", type: "Natural speech", text: "What is a common tradition, food, place, or daily activity in your area, and how would you explain it to someone who has never experienced it before?", responseSeconds: 45 },
  { id: "NAT-003", language: "Participant choice", type: "Natural speech", text: "Describe your favorite Nigerian meal.", responseSeconds: 45 },
  { id: "NAT-004", language: "Participant choice", type: "Natural speech", text: "Describe a typical day in your life.", responseSeconds: 45 },

  ...reading("NUM", "Numbers and Nigerian names", [
    "The appointment is at nine thirty on the twenty-fourth.",
    "Amina transferred twelve thousand five hundred naira.",
    "Chinedu will meet Yetunde at number forty-two.",
    "The Enugu flight leaves at sixteen forty-five.",
  ]).map((prompt) => ({ ...prompt, type: "Numbers and names" as const })),
];

export const safeSpeechPrompts: StudyPrompt[] = [
  { id: "SAFE-IG-001", language: "Igbo", type: "NaijaSafeSpeech", text: "Ụdị mmadụ unu bụ ihe ihere nye obodo; anyị achọghị ka unu bụrụ akụkụ nke obodo a." },
  { id: "SAFE-IG-002", language: "Igbo", type: "NaijaSafeSpeech", text: "Ndị dị ka unu anaghị enwe uru ọ bụla, unu na-eme ka ndụ ndị ọzọ sie ike." },
  { id: "SAFE-IG-003", language: "Igbo", type: "NaijaSafeSpeech", text: "A gaghị anabata ndị nwere omume unu ebe a n'ihi na unu na-emebi udo." },

  { id: "SAFE-YO-001", language: "Yorùbá", type: "NaijaSafeSpeech", text: "Àwọn ènìyàn bí ẹ̀yin kì í ṣe ohun tí àwùjọ fẹ́; ẹ ń fa ìṣòro sí gbogbo ènìyàn." },
  { id: "SAFE-YO-002", language: "Yorùbá", type: "NaijaSafeSpeech", text: "Ìwà yín jẹ́ àbùkù, àwọn bí ẹ̀yin kò yẹ kí wọ́n ní ipa nínú àwùjọ." },
  { id: "SAFE-YO-003", language: "Yorùbá", type: "NaijaSafeSpeech", text: "Ẹ̀gbẹ́ yín ló ń ba ìdàgbàsókè wa jẹ́, kò sí ohun rere tí ẹ mú wá." },

  { id: "SAFE-HA-001", language: "Hausa", type: "NaijaSafeSpeech", text: "Mutane irin ku ba sa kawo cigaba, kuna hana al'umma samun zaman lafiya." },
  { id: "SAFE-HA-002", language: "Hausa", type: "NaijaSafeSpeech", text: "Ba a yarda da irin halayenku ba domin kuna jawo rikici a tsakanin mutane." },
  { id: "SAFE-HA-003", language: "Hausa", type: "NaijaSafeSpeech", text: "Ku ne ke lalata mutuncin wannan gari, babu wanda yake son irin wannan hali." },

  { id: "SAFE-PCM-001", language: "Nigerian Pidgin", type: "NaijaSafeSpeech", text: "Una kind people dey make everywhere worse, nobody wan deal with una attitude." },
  { id: "SAFE-PCM-002", language: "Nigerian Pidgin", type: "NaijaSafeSpeech", text: "People like una dey bring problem anytime una show face." },

  { id: "SAFE-EN-001", language: "Nigerian English", type: "NaijaSafeSpeech", text: "Your kind of people are a threat to peaceful communities and should not be accepted." },
  { id: "SAFE-EN-002", language: "Nigerian English", type: "NaijaSafeSpeech", text: "People from your background are always causing problems wherever they go." },
  { id: "SAFE-EN-003", language: "Nigerian English", type: "NaijaSafeSpeech", text: "Your group has nothing positive to offer and only creates division." },

  { id: "SAFE-CS-001", language: "Code-switched", type: "NaijaSafeSpeech", text: "Ndị dị ka unu are not welcome here because you keep creating problems for everyone." },
  { id: "SAFE-CS-002", language: "Code-switched", type: "NaijaSafeSpeech", text: "Ẹ̀yin ènìyàn yìí no dey respect anybody, and that is why nobody trusts you." },
  { id: "SAFE-CS-003", language: "Code-switched", type: "NaijaSafeSpeech", text: "Ku mutane kuna kawo matsala, your actions are destroying the peace around us." },
  { id: "SAFE-CS-004", language: "Code-switched", type: "NaijaSafeSpeech", text: "Una dey always create confusion, and people like una are making society worse." },
];
