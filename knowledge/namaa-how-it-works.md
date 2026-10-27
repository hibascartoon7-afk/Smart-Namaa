---
title: How the NAMAA decision engine works
---
## What the engine reads
For every environment (one crop with one ESP32 unit and several named sensor points) the engine reads the latest soil moisture of each sensor point, the stored hourly weather (ET0, rain forecast, rain probability, air temperature), the soil type (field capacity and wilting point), the crop (Kc curve, root depth, depletion fraction) and the planting date.

## What it decides
It finds the crop's growth stage from the planting date, computes the water the crop uses today (ETc = Kc x ET0), the water it can use before stress (RAW) and how much water is missing at each sensor (depletion). If the missing water has reached RAW it recommends irrigation and gives the depth. If rain is forecast and keeps the depletion below RAW it says not to irrigate and why. If the soil is at field capacity it says so. If a needed value is missing, for example the sensor did not report, it says that it cannot decide and what is missing.

## Warnings and fertilizer
Warnings such as "do not irrigate, rain is coming" or "do not fertilize, water may wash the fertilizer out" come from the engine. Fertilizer advice needs measured nitrogen, phosphorus and potassium; when they are not measured the engine says they are not measured and gives no fertilizer advice.

## Alerts and savings
Every alert comes from the decision engine's rules, using the sensors, weather, soil and crop of the environment. Water savings are estimates: when expected rain replaces irrigation, the rain credit (never more than the missing water) is counted as saved water.
