# FlightCost × Aircraft Designer — Integration Stage 1

Статус: **первый пакет реализован для Aircraft Designer; не объявлять двустороннюю записью в FlightCost до патча второго репозитория**.

## В этом коммите

- `/aircraft-configurations.v1.json` — единые версии: ICAO-код, двигатель, профиль массы, ряды, фактическое число кресел, шаг рядов. Числа и схемы, где нет данных LOPA, помечены как плановые/оценочные.
- Интерфейс выбора компоновки: используется **тем же** `AircraftDefinition`, что расчётное ядро и Three.js. Ранее 194 кресла отрисовывались как 198, 225 как 228. Теперь частичный ряд честно содержит 2/3/4/5 кресел.
- URL `/?ac=B752&engine=RB211-535E4&layout=b752-225&embed=flightcost`: воспроизводимый самолёт и салон. `aircraft` и `profile` могут уточнить массу Ту-214.
- `postMessage` `DESIGN_EXPORT` в **только** `https://flightcost.app`; FlightCost должен проверить источник и подтвердить **реально сохранённый** объект `DESIGN_ACK` с соответствующим `requestId`.
- В экспорте есть массы и состав салона, но нет фиктивного расхода: расчётный ярус горючего выбирает FlightCost.
- Девять индексируемых статических страниц `/ru/type/<ICAO>/` с canonical, ссылками на FlightCost и `sitemap.xml`; страницы модифицированных проектов не индексируются.
- Исходник первого адаптера FlightCost лежит в `integration/flightcost/` и не подключается к FlightCost автоматически.

## Ограничения

- Текущий движок Aircraft Designer **не содержит PW1127G-JM**. Если FlightCost передаст `?ac=A20N&engine=PW1127G-JM`, конструктор покажет, что этот двигатель пока не поддерживается; экспорт заблокирован.
- Пресеты 194/210, 225/239, 244 **не являются сертифицированными чертежами LOPA**. Кухни, туалеты и аварийные выходы пока не перерасставляются по плану авиакомпании; физическое количество кресел совпадает с расчётом и экспортом.
- Сохранение в гостевой `user.db` и расчёт по сохранённому `USER:`-типу **пока не реализованы**. Для этого нужен актуальный исходник FlightCost и ревью интерфейса workspace; нельзя выдумывать адреса API или миновать существующие CSRF/ownership проверки.
- Caddy-конфигурация изменилась (разрешён CORS каталога для FlightCost и ограничены iframe-предки). Скрипт `deploy/ship.sh` выкладывает **только `dist/`** — Caddy обновляется отдельно администратором. На текущем VPS сначала убедиться, что новый статический сайт работает.

## Первый путь проверки на Mac

```bash
npm ci
npm test
npm run typecheck
npm run build
npm run dev
```

Проверь в браузере:

1. `/?ac=B752&engine=RB211-535E4&layout=b752-225` — выбор 225, в KPI 225, в JSON 225.
2. `/?ac=T214&layout=t214-194` — 194 мест в KPI, JSON и последнем неполном ряду.
3. `/?ac=A20N&engine=LEAP-1A&layout=a320-194` — 194 мест, LEAP-1A.
4. `/?ac=A20N&engine=PW1127G-JM` — **понятное сообщение о недоступности**, экспорт заблокирован до явного выбора существующего LEAP-1A.
5. `/ru/type/A20N/` и `/sitemap.xml` — реальные HTML/XML без JS.
6. Двигатели 757 — RB211 и PW2037 в 3D и экспортируемом JSON.

## Встраивание на FlightCost (следующий коммит второго репозитория)

Необходима проверка актуального `flightcostapp/seo.py`, обработчика гостевого workspace (и всех его CSRF/owner гейтов), `flightcostapp/econ.py` и `deploy/`. Исходники FlightCost не содержатся в этой рабочей копии, поэтому **PR на FlightCost не был создан**.

`integration/flightcost/flightcost-embed.js` умеет открывать iframe в `<dialog>` и принимать экспорт. Он принимает `saveDesign` только в виде переданной функции, а не запускает неподтверждённый адрес API. `bridge_validator.py` — минимальная проверка серверного объекта.

Дальнейший контракт:

```
FlightCost /ru/type/B752
  └─ modal Aircraft Designer /?ac=B752&engine=RB211-535E4&layout=b752-186&embed=flightcost
      └─ пользователь меняет салон/рычаги
          └─ DESIGN_EXPORT { aircraft{...seats, cabin}, weights{...}, model{...} }
              └─ FlightCost validates + persists to user's existing workspace
                  └─ DESIGN_ACK { saved: true } (ТОЛЬКО ПОСЛЕ commit)
                      └─ FlightCost calculation with matching seats and documented burn method
```

Варианты двигателей не отождествляются по одному ICAO. Для 757 виджет может явно разрешить два двигателя; неподдерживаемые варианты не заменяются скрыто.

## Деплой на текущий VPS

После проверки на Mac, коммита и `git push`:

```bash
bash deploy/ship.sh deploy@aircraft-designer-vps
```

Изменённую Caddy-конфигурацию необходимо отдельно передать на сервер и провести `sudo caddy validate --config /etc/caddy/Caddyfile` до reload. Не запускать `init-server.sh` повторно: он специально отвергает уже существующий сайт, чтобы избежать потери текущих настроек.
