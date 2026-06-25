export class Animal {
  private name: string;

  constructor(name: string) {
    this.name = name;
  }

  rename(name: string): void {
    this.name = name;
  }
}
