import {Link} from '@react-navigation/native';
import {observer} from 'mobx-react';
import React from 'react';
import {
  GestureResponderEvent,
  Platform,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import {
  Button,
  HelperText,
  IconButton,
  Modal,
  Portal,
  Text,
  TextInput,
} from 'react-native-paper';
import Container from '../components/Container';
import HCaptcha, {HCaptchaMessage} from '../components/HCaptcha';
import MFAInput from '../components/MFAInput';
import useLogger from '../hooks/useLogger';
import {IAPILoginResponse, LoginSchema} from '../interfaces/api';
import {DomainContext} from '../stores/DomainStore';
import {RootStackScreenProps} from '../types';
import {Routes} from '../utils/Endpoints';
import {t} from '../utils/i18n';
import {messageFromFieldError} from '../utils/messageFromFieldError';

function LoginScreen({navigation}: RootStackScreenProps<'Login'>) {
  const dimensions = useWindowDimensions();
  const domain = React.useContext(DomainContext);
  const logger = useLogger('LoginScreen');

  const [login, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [errors, setErrors] = React.useState<{
    login?: string;
    username?: string;
    password?: string;
    dob?: string;
  }>({login: '', password: ''});
  const [isLoading, setIsLoading] = React.useState(false);
  const [captchaModalVisible, setCaptchaModalVisible] = React.useState(false);
  const [captchaSiteKey, setCaptchaSiteKey] = React.useState<
    string | undefined
  >();
  const [captchaKey, setCaptchaKey] = React.useState<string | undefined>();
  const [shouldShowMFA, setShouldShowMFA] = React.useState(false);
  const [mfaTicket, setMFATicket] = React.useState<string | undefined>();

  const hideCaptchaModal = () => setCaptchaModalVisible(false);
  const showCaptchaModal = () => setCaptchaModalVisible(true);

  React.useEffect(() => {
    if (Object.values(errors).some(Boolean)) {
      setIsLoading(false);
    }
  }, [errors]);

  // clears the captcha key and site key
  const resetCaptcha = () => {
    setCaptchaKey(undefined);
    setCaptchaSiteKey(undefined);
  };

  // handles login button press
  const handleSubmit = (e?: GestureResponderEvent) => {
    if (isLoading && !captchaKey) {
      return;
    }

    e?.preventDefault();
    setIsLoading(true);

    if (!login || login === '') {
      setErrors({login: t('common:errors.INVALID_LOGIN')!});
      return;
    }

    if (!password || password === '') {
      setErrors({password: t('common:errors.INVALID_LOGIN')!});
      return;
    }

    domain.rest
      .post<LoginSchema, IAPILoginResponse>(Routes.login(), {
        login,
        password,
        captcha_key: captchaKey,
      })
      .then(res => {
        if ('captcha_key' in res) {
          const {captcha_key, captcha_service, captcha_sitekey} = res;
          if (captcha_key[0] === 'captcha-required') {
            if (captcha_service === 'hcaptcha') {
              logger.debug('hCaptcha required');
              setCaptchaSiteKey(captcha_sitekey);
              showCaptchaModal();
              return;
            }

            setErrors({
              login: `Unhandled captcha_service ${captcha_service} `,
            });
            resetCaptcha();
            return;
          }

          setErrors({
            login: `Unhandled captcha_key ${captcha_key} `,
          });
          resetCaptcha();
          return;
        } else if ('mfa' in res) {
          // TODO: handle webauthn
          logger.debug('MFA Required');
          setShouldShowMFA(true);
          setMFATicket(res.ticket);
          return;
        } else if ('token' in res) {
          logger.debug('success', res);
          domain.account.setToken(res.token);
          resetCaptcha();
          return;
        } else {
          if ('code' in res) {
            if (res.code === 50035 && res.errors) {
              const t = messageFromFieldError(res.errors);
              if (t) {
                const {field, error} = t;
                setErrors({[field ?? 'login']: error});
                resetCaptcha();
                return;
              }
            }

            setErrors({login: res.message});
            resetCaptcha();
            return;
          }

          setErrors({
            login: t('common:errors.UNKNOWN_ERROR') as string,
          });
          resetCaptcha();
          return;
        }
      })
      .catch(e => {
        setErrors({
          login: e.message,
        });
        resetCaptcha();
      });
  };

  const handleBack = () => {
    setIsLoading(true);
    navigation.goBack();
  };

  const handlePasswordReset = () => {
    if (isLoading) {
      return;
    }

    setIsLoading(true);

    if (!login || login === '') {
      setErrors({
        login: t('common:errors.INVALID_LOGIN') as string,
      });
      return;
    }

    // TODO: password reset request
    // TODO: show modal on success (/failure?)
    logger.debug('handle password reset');
    setIsLoading(false);
  };

  const onCaptchaMessage = (message: HCaptchaMessage) => {
    const {event, data} = message;
    switch (event) {
      case 'cancel':
        logger.debug('[HCaptcha] Captcha cancelled by user');
        hideCaptchaModal();
        break;
      case 'close':
        logger.debug('[HCaptcha] Captcha closed');
        break;
      case 'challenge-expired':
      case 'data-expired':
        logger.debug('[HCaptcha] Captcha expired');
        hideCaptchaModal();
        break;
      case 'open':
        logger.debug('[HCaptcha] Captcha opened');
        break;
      case 'error':
        logger.error('[HCaptcha] Captcha error', errors);
        hideCaptchaModal();
        break;
      case 'data':
        logger.debug('[HCaptcha] Captcha data', data);
        hideCaptchaModal();
        setCaptchaKey(data);
        break;
    }
  };

  // Resubmit login request after captcha is completed
  React.useEffect(() => {
    if (!captchaKey) {
      return;
    }
    setCaptchaSiteKey(undefined);

    handleSubmit();
  }, [captchaKey]);

  if (shouldShowMFA && mfaTicket) {
    return (
      <MFAInput close={() => setShouldShowMFA(false)} mfaTicket={mfaTicket} />
    );
  }

  return (
    <Container testID="mainContainer" horizontalCenter verticalCenter flexOne>
      <Portal>
        <Modal
          visible={captchaModalVisible}
          onDismiss={() => {
            hideCaptchaModal();
            setIsLoading(false);
          }}
          style={styles.modalContainer}
          contentContainerStyle={styles.modalContentContainer}>
          {captchaSiteKey && (
            <HCaptcha siteKey={captchaSiteKey} onMessage={onCaptchaMessage} />
          )}
        </Modal>
      </Portal>

      <Container
        testID="innerContainer"
        style={[
          styles.loginContainer,
          {
            minWidth: !Platform.isMobile
              ? dimensions.width / 2.5
              : dimensions.width,
          },
        ]}>
        <Container
          testID="contentContainer"
          verticalCenter
          style={styles.contentContainer}>
          {/* Mobile Back Button */}
          {Platform.isMobile && (
            <IconButton
              icon="arrow-left"
              size={20}
              onPress={handleBack}
              style={styles.mobileBack}
            />
          )}
          {/* Header */}
          <Container testID="headerContainer" horizontalCenter>
            <Text variant="headlineSmall" style={{fontWeight: '600'}}>
              {t('login:TITLE')}
            </Text>
            {!Platform.isMobile && (
              <Link to={{screen: 'Register'}} style={styles.link}>
                <Text
                  variant="bodyLarge"
                  style={[{fontWeight: '400', marginRight: 5}]}>
                  {t('login:NEED_ACCOUNT')}
                </Text>
              </Link>
            )}
          </Container>

          {/* Form */}
          <Container testID="formContainer" style={styles.formContainer}>
            {/* Email */}
            <Container testID="emailWrapper">
              <TextInput
                label={t('login:LABEL_EMAIL') as string}
                textContentType="emailAddress"
                value={login}
                onChangeText={text => setEmail(text)}
                style={styles.input}
                disabled={isLoading}
                error={!!errors.login}
              />
              <HelperText
                type="error"
                visible={!!errors.login}
                style={styles.helperText}>
                {errors.login}
              </HelperText>
            </Container>

            {/* Password */}
            <Container testID="passwordWrapper">
              <TextInput
                label={t('login:LABEL_PASSWORD') as string}
                textContentType="password"
                secureTextEntry
                value={password}
                onChangeText={text => setPassword(text)}
                style={styles.input}
                disabled={isLoading}
                error={!!errors.password}
              />
              <HelperText
                type="error"
                visible={!!errors.password}
                style={styles.helperText}>
                {errors.password}
              </HelperText>
              <Container testID="forgotPasswordContainer">
                <Text style={styles.link} onPress={handlePasswordReset}>
                  {t('login:LABEL_FORGOT_PASSWORD')}
                </Text>
              </Container>
            </Container>

            {/* Login Button */}
            <Button
              mode="contained"
              disabled={isLoading}
              loading={!Platform.isWindows && isLoading}
              onPress={handleSubmit}
              style={{marginVertical: 16}}
              labelStyle={styles.buttonLabel}>
              {t('login:BUTTON_LOGIN')}
            </Button>
          </Container>
        </Container>
      </Container>
    </Container>
  );
}

const styles = StyleSheet.create({
  mobileBack: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  loginContainer: {
    // minWidth: 800,
    // minHeight: 400,
    padding: 32,
    borderRadius: 8,
  },
  contentContainer: {
    height: '100%',
  },
  formContainer: {
    marginVertical: 32,
  },
  input: {
    marginVertical: 8,
  },
  helperText: {
    fontStyle: 'italic',
  },
  link: {
    color: '#7289da',
  },
  buttonLabel: {fontWeight: '400', fontSize: 16},
  modalContainer: {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContentContainer: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default observer(LoginScreen);
