export interface ClothLoginState {
  loading: boolean;
  primaryLabel: string;
  passwordLabel: string;
  buttonLabel: string;
  title: string;
}
export interface ClothLoginController {
  update(state: ClothLoginState): void;
  destroy(): void;
}
export function mountClothLogin(root: HTMLElement, onEntranceReady?: () => void): ClothLoginController;
