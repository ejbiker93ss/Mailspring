import { SoundRegistry } from 'summermail-exports';

export function activate() {
  SoundRegistry.register('send', 'summermail://custom-sounds/CUSTOM_UI_Send_v1.ogg');
  SoundRegistry.register('confirm', 'summermail://custom-sounds/CUSTOM_UI_Confirm_v1.ogg');
  SoundRegistry.register('hit-send', 'summermail://custom-sounds/CUSTOM_UI_HitSend_v1.ogg');
  SoundRegistry.register('new-mail', 'summermail://custom-sounds/CUSTOM_UI_NewMail_v1.ogg');
}

export function deactivate() {
  SoundRegistry.unregister(['send', 'confirm', 'hit-send', 'new-mail']);
}
