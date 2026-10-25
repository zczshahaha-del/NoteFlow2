export interface ClothLoginState {
  loading: boolean;
  buttonLabel: string;
  title: string;
  showBack: boolean;
}
export interface ClothLoginController {
  update(state: ClothLoginState): void;
  destroy(): void;
}
export function mountClothLogin(root: HTMLElement, onEntranceReady?: () => void): ClothLoginController;
