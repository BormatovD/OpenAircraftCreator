# Подвески Boeing 737 Classic и 737 MAX

## Область модели

Параметры относятся к `B737-300 / CFM56-3B2` и `737-8 MAX / LEAP-1B`. Они разделяют три вещи: форму стойки (pylon/strut), крепления двигателя к стойке и силовой путь тяги. Числа в `web/scene/pylon737.ts` — эскизная геометрия для иллюстрации, не координаты Boeing AMM/чертежа и не данные для обслуживания.

Начало оси `x` — плоскость входа двигателя; `r` — радиус от оси до корпуса у опоры; `z` — боковая координата левого/правого крепления. Boeing публикует общие виды и эксплуатационные габариты, но открытые материалы не дают размерного контура пилона и координат узлов крепления. Поэтому геометрию стойки оценивал по общим видам и масштабу, а положения проушин и станций капотов округлил до эскизных значений. Не следует трактовать точность до сантиметра.

## Что подтверждено по архитектуре

| Установка | Engine-to-pylon supports | Путь тяги | Пилон к крылу | Капоты |
|---|---|---|---|---|
| 737-300, CFM56-3B2 | Передняя опора с двумя боковыми точками на fan frame и одна центральная задняя опора на turbine frame. | Две тяги от fan-frame mid-box идут к evener bar и thrust fitting на стойке. Это отдельная связь, не третья опора двигателя. | Стойка передаёт нагрузки в крыло через собственные силовые узлы/лонжеронные элементы; наружные доступные схемы не дают их монтажных координат. | Fan cowl состоит из двух половин. Станции шарниров и нижних замков в параметрах эскизные. Classic имеет сплюснутую верхнюю часть внешнего контура двигателя; её следует строить по мешу самолёта, а не по круговому сечению.
| 737-8 MAX, LEAP-1B | Отдельные forward mount assembly (forward hanger + side link) и более сложная aft mount assembly (aft hanger, center link, evener bar, tangent link). Не сводить aft mount к одной простой серьге. | Документ по монтажу двигателя говорит о thrust links во множественном числе, с precooler между ними. В визуальной схеме оставлены парные тяги. Открытая компонентная схема перечисляет thrust-link assembly, но не даёт точек установки; точная кинематическая схема и локальные координаты остаются условными. | Пилон/стойка — отдельная конструкция между крылом и двумя engine mounts. Данные по mount assembly описывают крепления двигателя, а не крепление стойки к крылу. | Две половины fan cowl с integrated hinge beam. В CFM index узел hinge beam выделен отдельной позицией. Раскладка замков на наружном виде — пропорциональная, без претензии на AMM stationing.

Для Classic учебный материал описывает передний узел как две cone-bolt точки с виброизоляторами на поперечине стойки; передние тяги закреплены на fan-frame mid-box примерно в положениях 10 и 2 часов и сходятся через evener bar к thrust fitting стойки. Задняя опора — центральный cone bolt/изолятор на стойке; две короткие связи соединяют hanger с turbine-frame lugs. Поэтому в `PylonSpec` задняя точка единичная, а `thrustLinks` — `paired`.

Для MAX каталог компонентов LEAP называет forward fitting hanger и side link, а aft hanger, center link, evener bar, tangent link и thrust-link assembly. CFM engine-change training отдельно отмечает зазор между thrust links, в котором находится precooler. Мы задаём `thrustLinks: "paired"`, но не рисуем произвольное число точек крепежа или кинематических шарниров внутри aft mount.

## Эскизные параметры

В `pylon737.ts` параметры `noseX/shoulderX`, подъёмы и ширина задают наружный силуэт пилона относительно оси/входа двигателя; `aftWingFraction` привязывает хвост стойки к доле хорды крыла. Передняя и задняя координаты описывают engine-to-pylon mounts. `thrustCase` указывает место тяговой связи на корпусе; сама связь отдельна от опор. `latchStations`/`hingeStations` — лишь продольные ориентиры двух половин fan cowl, а не подтверждённое количество замков/шарнирных кронштейнов.

В обоих вариантах выбраны два фан-капота (`cowlPanels: "halves"`). У MAX подтверждён отдельный integrated hinge beam; у Classic число деталей/конкретная реализация шарнира здесь не моделируется. Верхний контур Classic надо снимать с настоящей геометрии гондолы: эти данные не восстанавливают его из радиуса.

## Источники и пределы точности

1. [Boeing, 737 Airplane Characteristics for Airport Planning, D6-58325-6, Rev E, Nov 2023](https://www.boeing.com/content/dam/boeing/v2/airports/acaps/737CL_REV_E.pdf), секции 2.1.6 и 2.2.3; общая установка и общий вид 737-300. Это внешний габаритный чертёж, не ATA 54/71; он не подтверждает монтажную топологию. Для габаритного применения Boeing предупреждает об ограниченной точности airport-planning drawing.
2. [Lufthansa Technical Training, B737-300/400/500 CFM56-3, ATA 71-21 Engine Mounts](https://www.scribd.com/document/758562162/ATA-71-80-L3-edited), страницы 27–28 скана (раздел Engine Mounts и схема на стр. 28). Подробно описывает три точки опоры, две forward thrust links, evener bar, forward crossbeam/isolators и aft hanger. Training copy, не действующая инструкция по обслуживанию.
3. [Boeing CFM56-3 CMM 71-21-13, Engine Mount Components](https://electronicsandbooks.com/edt/manual/Hardware/B/Boeing/737/737_ALL_CMMOHM_D6-17370_TD/PDF/CMM-71-21-13-81205-20090701-049-___.PDF), идентификатор CMM 71-21-13, выпуск 1 Jul 2008. Первичный документ Boeing в сторонней библиотеке; применимость нужно сверять по серийному номеру/эффективности конкретного самолёта.
4. [Boeing, 737 MAX Airplane Characteristics for Airport Planning, D6-38A004, Rev K, Jul 2025](https://www.boeing.com/content/dam/boeing/v2/airports/acaps/737MAX_RevK.pdf), для MAX 8 — общий размерный чертёж 2.2.2, стр. 2-10; ground-clearance drawing 2.3.2, стр. 2-14. Эти виды годятся для внешнего масштаба и положения двигателя; по ним нельзя восстановить точки подвеса или устройство пилона.
5. [CFM LEAP Technical Manual Index, Apr 1 2026](https://app-cins01saas8d02vp001.cms.optimizely.com/globalassets/leap---component-maintenance-manuals-index_april-01-2026.pdf), ATA 71: 71-15-10 Integrated Hinge Beam Assembly 610C6300-039 (Nexcelle), 71-21-00 Forward Mount Assembly 610C0030-505 и 71-22-00 Aft Mount Assembly 610C0040-505 (CFM). Подтверждает состав и раздельные позиции, не геометрию установочных точек.
6. [Able Aerospace, LEAP-1B Engine Mounting System](https://www.ableaerospace.com/wp-content/uploads/2025/09/Boeing-737-Max_Leap-1B-Engine-Mounting-System.pdf), лист компонента, все серии: forward mount assembly/fitting hanger/side link и aft mount assembly/aft hanger/center link/evener bar/tangent link/thrust-link assembly. Полезная иллюстрация реальных деталей; поставщик ремонта, а не источник размерной геометрии самолёта.
7. [CFM LEAP-1B Engine Change Lessons Learned, Xi'an, Apr 17–18 2018](https://id.scribd.com/document/495026245/LEAP-1B-Engine-Change-Lessons-Learned), слайды 14–15: thrust links располагаются по обе стороны precooler; отмечены отдельные операции с forward/aft mount bolts. Это обучение техническому обслуживанию, доступная копия, а не монтажная схема с координатами.

Источники 2, 3 и 7 подтверждают общую логику креплений, но только по указанной серии и типу; источники 1 и 4 поддерживают внешнюю форму/размер. Все численные координаты в `pylon737.ts`, а также лatches/hinges и детали крепления стойки к крылу, остаются эскизными.

### Крепление стойки к крылу

В открытом виде отдельно видны присоединительные детали у крыла и диагональный подкос. Для 737 Classic подкос и ответный узел на крыле указаны в директиве FAA 2020-14-03. Для 737-8 Boeing отдельно перечисляет крепления стойки и диагональный подкос в приложении к договору поставки. Длины, наклоны и разнесение элементов в эскизе приблизительны. [FAA AD 2020-14-03 в базе EASA](https://ad.easa.europa.eu/ad/US-2020-14-03) · [Boeing 737-8, Exhibit C, Part 3](https://www.sec.gov/Archives/edgar/data/92380/000009238022000007/exhibit1018boeingpurchasea.htm)
