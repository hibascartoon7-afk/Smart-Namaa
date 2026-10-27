export type MeasurementStatus =
  | "measured"
  | "not_measured"
  | "sensor_error";

export interface SensorData {
  moisture: number | null;
  soilTemperature: number | null;
  ec: number | null;

  moistureStatus: MeasurementStatus;
  soilTemperatureStatus: MeasurementStatus;
  ecStatus: MeasurementStatus;
}

export interface WeatherData {
  et0: number | null;
  rainProbability: number | null;
  precipitation: number | null;
}

export interface IrrigationDecision {
  status:
    | "recommend_irrigation"
    | "do_not_irrigate"
    | "insufficient_data";

  reason: string;

  missingVariables?: string[];
}

export interface FertilizationDecision {
  status:
    | "available"
    | "insufficient_data";

  reason: string;

  missingVariables?: string[];
}

export interface DecisionResult {
  irrigation: IrrigationDecision;
  fertilization: FertilizationDecision;
}
