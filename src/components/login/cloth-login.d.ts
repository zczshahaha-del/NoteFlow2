export interface ClothLoginState {
  loading: boolean;
  primaryLabel: string;
  passwordLabel: string;
  buttonLabel: string;
  subtitle: string;
  help: string;
  helpDetail: string;
}
export interface ClothLoginController {
  update(state: ClothLoginState): void;
  destroy(): void;
}
export function mountClothLogin(root: HTMLElement): ClothLoginController;
