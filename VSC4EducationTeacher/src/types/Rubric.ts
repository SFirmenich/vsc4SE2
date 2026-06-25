export interface RubricLevel {
  value: number;
  label: string;
  description?: string;
}

export interface RubricCriterion {
  id: string;
  title: string;
  description?: string;
  weight: number;
  taskIds?: string[];
  levels: RubricLevel[];
}

export interface Rubric {
  id: string;
  title: string;
  criteria: RubricCriterion[];
}
