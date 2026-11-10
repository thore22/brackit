# Machbarkeit der Volleyballvorlage

| Abschnitt | Begegnungen | Slots | Zeitfenster einschließlich Wechselzeit |
| --- | ---: | ---: | --- |
| Vorrunde A/B/C/D | 18 | 9 | 10:00–12:42 |
| Mittagspause | — | — | 12:42–13:27 |
| Gold und Silber | 30 | 15 | 13:27–17:57 |
| Crossover D1–C3 | 1 | 1 | 17:57–18:15 |

Vierergruppen liefern je sechs Spiele und drei Einsätze pro Team. Dreiergruppen liefern je drei Spiele und zwei Einsätze pro Team. Insgesamt sind 14 × 7 ÷ 2 = 49 Begegnungen erforderlich. Zwei Felder ergeben als Kapazitätsuntergrenze ⌈49 ÷ 2⌉ = 25 Slots. Die letzte reguläre Spielzeit endet um 18:12 Uhr. Drei Minuten Wechselzeit belegen das Restfenster bis 18:15 Uhr. Ein Zusatzpunkt kann das Fenster überschreiten. Dafür gibt es keine Zeitreserve.

| Klasse | Rangplätze | Übernommene Ergebnisse |
| --- | --- | --- |
| Gold | A1, B1, C1, D1, A2, B2, C2 | A1–A2, B1–B2, C1–C2 |
| Silber | D2, A3, B3, C3, D3, A4, B4 | A3–A4, B3–B4, D2–D3 |

Jede Klasse benötigt zunächst 31 neue Einsätze. Das Crossover verbraucht je einen Einsatz pro Klasse, sodass 30 Einsätze beziehungsweise 15 Spiele je Klasse verbleiben. Alle Teams aus A und B spielen nachmittags viermal. C1, C2, D2 und D3 spielen fünfmal in ihrer Klasse. D1 und C3 spielen viermal in ihrer Klasse und einmal im Crossover. Die sechs übernommenen Resultate referenzieren bestehende Spiele. Das Crossover wirkt ausschließlich auf die Zahl ausgetragener Spiele.

Die fünf logischen Runden jeder Klasse benötigen je ein Matching mit drei Paaren und einem Freilos. Teams mit fünf Klassenspielen haben kein Freilos. Die fünf übrigen Teams haben jeweils genau eines und übernehmen in dieser Runde das Schiedsgericht. In der Vorrunde dürfen wegen dieser Schiedsrichterregel niemals zwei Begegnungen derselben Gruppe im selben Slot stattfinden. Die Paarungen werden zusammen mit Feld- und Pfeifzuordnungen geprüft.

Die Engine behandelt Kapazität und Parität als notwendige Bedingungen. Anschließend sucht sie zulässige Paarungen, Runden und Slotbelegungen und prüft die vollständige Matrix. Sie meldet ein erreichtes Suchlimit gesondert. Alle Zeiten sind Ortszeiten am konfigurierten Turniertag.
