import { Appearance } from 'react-native';
import {
  createClient,
  JsonMap,
  UserTraits,
  GroupTraits,
} from '@segment/analytics-react-native';
import axios from 'axios';
import DefaultPreference from 'react-native-default-preference';
import { bufferToHex, keccak } from 'ethereumjs-util';
import Logger from '../../util/Logger';
import {
  AGREED,
  DENIED,
  METRICS_OPT_IN,
  METAMETRICS_ID,
  ANALYTICS_DATA_DELETION_DATE,
  MIXPANEL_METAMETRICS_ID,
  METAMETRICS_SEGMENT_REGULATION_ID,
  DATA_SET_CONNECTED_FLAG,
} from '../../constants/storage';
import { store } from '../../store';
import AUTHENTICATION_TYPE from '../../constants/userProperties';

import {
  IMetaMetrics,
  States,
  DataDeleteResponseStatus,
  UserIdentityProperties,
} from './MetaMetrics.types';
import {
  ON,
  OFF,
  METAMETRICS_ANONYMOUS_ID,
  SEGMENT_REGULATIONS_ENDPOINT,
} from './MetaMetrics.constants';
import { EVENT_NAME } from './MetaMetrics.events';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
class MetaMetrics implements IMetaMetrics {
  static #instance: MetaMetrics;

  // PRIVATE CLASS VARIABLES

  #metametricsId = '';
  #segmentClient: any;
  #state: States = States.disabled;
  #deleteRegulationDate = '';
  #isDataRecorded = false;
  #mixPanelBackwardsCompatibilityFlag = false;
  #dataSetConnectedFlag = false;

  // CONSTRUCTOR

  constructor(segmentClient: any) {
    this.#segmentClient = segmentClient;
    this.#init();
  }

  // PRIVATE METHODS

  /**
   * Method to initialize private variables async.
   */
  async #init() {
    this.#state = await this.#getMetricsPreference();
    if (__DEV__) Logger.log(`Current MetaMatrics State: ${this.#state}`);

    this.#metametricsId = await this.#getMetaMetricsId();
    // The alias method is used to merge two user identities
    // by connecting two sets of user data as one.
    await this.#alias();
    this.#state === States.enabled && (await this.#setInitialUserProperties());
  }

  /**
   * Method to generate or retrieve the analytics user ID.
   *
   * @returns Promise containing the user ID.
   */
  async #getMetaMetricsId(): Promise<string> {
    let metametricsId: string | undefined;

    // Legacy ID from MixPanel integration
    metametricsId = await DefaultPreference.get(MIXPANEL_METAMETRICS_ID);
    if (metametricsId && !__DEV__) {
      this.#mixPanelBackwardsCompatibilityFlag = true;
      return metametricsId;
    }

    metametricsId = await DefaultPreference.get(METAMETRICS_ID);
    if (!metametricsId) {
      metametricsId = bufferToHex(
        keccak(
          Buffer.from(
            String(Date.now()) +
              String(Math.round(Math.random() * Number.MAX_SAFE_INTEGER)),
          ),
        ),
      );
      await DefaultPreference.set(METAMETRICS_ID, metametricsId);
    }
    if (__DEV__) Logger.log(`Current MetaMatrics ID: ${metametricsId}`);
    return metametricsId;
  }

  /**
   * Merge two user identities by connecting two sets of user data as one.
   * https://segment.com/docs/connections/sources/catalog/libraries/mobile/react-native/#alias
   *
   * @param userId - User ID generated for Segment
   * @param userTraits - Object containing user relevant traits or properties (optional).
   */
  async #alias(): Promise<void> {
    if (this.#dataSetConnectedFlag) {
      return;
    }

    if ((await DefaultPreference.get(DATA_SET_CONNECTED_FLAG)) === 'true') {
      this.#dataSetConnectedFlag = true;
      return;
    }

    this.#segmentClient.alias(this.#metametricsId);
    this.#segmentClient.flush();

    this.#dataSetConnectedFlag = true;
    await DefaultPreference.set('true', DATA_SET_CONNECTED_FLAG);
  }

  /**
   * Method to associate traits or properties to an user.
   * Check Segment documentation for more information.
   * https://segment.com/docs/connections/sources/catalog/libraries/mobile/react-native/#identify
   *
   * @param userId - User ID generated for Segment
   * @param userTraits - Object containing user relevant traits or properties (optional).
   */
  #identify(userTraits: UserIdentityProperties): void {
    // The identify method lets you tie a user to their actions
    // and record traits about them. This includes a unique user ID
    // and any optional traits you know about them
    this.#segmentClient.identify(this.#metametricsId, userTraits as UserTraits);
    this.#segmentClient.flush();
  }

  /**
   * Method to associate an user to a specific group.
   * Check Segment documentation for more information.
   * https://segment.com/docs/connections/sources/catalog/libraries/mobile/react-native/#group
   *
   * @param groupId - Group ID to associate user
   * @param groupTraits - Object containing group relevant traits or properties (optional).
   */
  #group(groupId: string, groupTraits?: GroupTraits): void {
    // The Group method lets you associate an individual user with a group—
    // whether it’s a company, organization, account, project, or team.
    // This includes a unique group identifier and any additional
    // group traits you may know
    this.#segmentClient.group(groupId, groupTraits);
  }

  /**
   * Method to track an analytics event.
   * Check Segment documentation for more information.
   * https://segment.com/docs/connections/sources/catalog/libraries/mobile/react-native/#track
   *
   * @param event - Analytics event name.
   * @param anonymously - Boolean indicating if the event should be anonymous.
   * @param properties - Object containing any event relevant traits or properties (optional).
   */
  #trackEvent(
    event: EVENT_NAME,
    anonymously: boolean,
    properties: JsonMap,
  ): void {
    if (anonymously) {
      // If the tracking is anonymous, there should not be a MetaMetrics ID
      // included, MetaMetrics core should use the METAMETRICS_ANONYMOUS_ID
      // instead.
      this.#segmentClient.track(
        event,
        properties,
        METAMETRICS_ANONYMOUS_ID,
        METAMETRICS_ANONYMOUS_ID,
      );
    } else {
      // The Track method lets you record the actions your users perform.
      // Every action triggers an event, which also has associated properties
      // that the track method records.
      this.#segmentClient.track(
        event,
        properties,
        this.#metametricsId,
        METAMETRICS_ANONYMOUS_ID,
      );
      this.#isDataRecorded = true;
    }
  }

  /**
   * Method to clear the internal state of the library for the current user and group.
   * https://segment.com/docs/connections/sources/catalog/libraries/mobile/react-native/#reset
   */
  #reset(): void {
    this.#segmentClient.reset(METAMETRICS_ANONYMOUS_ID);
  }

  /**
   * Method to update the user analytics preference and
   * store it in DefaultPreference.
   */
  #setMetricsPreference = async () => {
    try {
      await DefaultPreference.set(
        METRICS_OPT_IN,
        this.#state === States.enabled ? AGREED : DENIED,
      );
    } catch (e: any) {
      const errorMsg = 'Error storing Metrics OptIn flag in user preferences';
      Logger.error(e, errorMsg);
    }
  };

  /**
   * Method to update the user analytics preference and
   * store it in DefaultPreference.
   */
  #getMetricsPreference = async (): Promise<States> => {
    try {
      const preference = await DefaultPreference.get(METRICS_OPT_IN);
      return preference === AGREED ? States.enabled : States.disabled;
    } catch (e: any) {
      const errorMsg = 'Error getting Metrics OptIn flag in user preferences';
      Logger.error(e, errorMsg);
      return States.disabled;
    }
  };

  /**
   * Method to store the date (format: DAY/MONTH/YEAR)
   * a request to create a delete regulation
   * was created in DefaultPreference.
   */
  #storeDeleteRegulationCreationDate = async (): Promise<void> => {
    const currentDate = new Date();
    const month = currentDate.getUTCMonth() + 1;
    const day = currentDate.getUTCDate();
    const year = currentDate.getUTCFullYear();

    this.#deleteRegulationDate = `${day}/${month}/${year}`;
    await DefaultPreference.set(
      ANALYTICS_DATA_DELETION_DATE,
      this.#deleteRegulationDate,
    );
  };

  /**
   * Method to store segment's Regulation ID in DefaultPreference.
   *
   * @param regulationId - Segment's Regulation ID.
   */
  #storeDeleteRegulationId = async (regulationId: string): Promise<void> => {
    await DefaultPreference.set(
      METAMETRICS_SEGMENT_REGULATION_ID,
      regulationId,
    );
  };

  /**
   * Method to generate a new delete regulation for an user.
   * This is necessary to respect the GDPR and CCPA regulations.
   * Check Segment documentation for more information.
   * https://segment.com/docs/privacy/user-deletion-and-suppression/
   *
   * @returns Object containing the status and an error (optional)
   */
  #createDeleteRegulation = async (): Promise<{
    status: DataDeleteResponseStatus;
    error?: string;
  }> => {
    const segmentToken = process.env.SEGMENT_DELETION_API_KEY;
    const regulationType = 'DELETE_ONLY';
    try {
      const response = await axios({
        url: SEGMENT_REGULATIONS_ENDPOINT,
        method: 'POST',
        headers: {
          'Content-Type': 'application/vnd.segment.v1alpha+json',
          Authorization: `Bearer ${segmentToken}`,
        },
        data: JSON.stringify({
          regulationType,
          subjectType: 'USER_ID',
          subjectIds: [this.#metametricsId],
        }),
      });
      const { data, status } = response as any;

      if (status === 200) {
        const { regulateId } = data.data;
        this.#isDataRecorded = false;
        await this.#storeDeleteRegulationId(regulateId);
        await this.#storeDeleteRegulationCreationDate();
        return { status: DataDeleteResponseStatus.ok };
      }

      return { status: DataDeleteResponseStatus.error };
    } catch (error: any) {
      Logger.error(error, 'Analytics Deletion Task Error');
      return { status: DataDeleteResponseStatus.error, error };
    }
  };

  #getDeleteRegulationId = async (): Promise<string> =>
    await DefaultPreference.get(METAMETRICS_SEGMENT_REGULATION_ID);

  #getDeleteRegulationDate = async (): Promise<string> => {
    if (this.#deleteRegulationDate) {
      return this.#deleteRegulationDate;
    }

    return await DefaultPreference.get(ANALYTICS_DATA_DELETION_DATE);
  };

  async #setInitialUserProperties(): Promise<void> {
    if (!this.#metametricsId) {
      this.#metametricsId = await this.#getMetaMetricsId();
    }
    const reduxState = store.getState();
    const preferencesController =
      reduxState?.engine?.backgroundState?.PreferencesController;
    const appTheme = reduxState?.user?.appTheme;
    // This will return either "light" or "dark"
    const appThemeStyle =
      appTheme === 'os' ? Appearance.getColorScheme() : appTheme;

    this.#identify({
      'Enable OpenSea API': preferencesController?.openSeaEnabled ? ON : OFF,
      'NFT AutoDetection': preferencesController?.useCollectibleDetection
        ? ON
        : OFF,
      token_detection_enable: preferencesController.useTokenDetection
        ? ON
        : OFF,
      Theme: appThemeStyle,
    });
  }

  /**
   * Apply User Property
   *
   * @param {string} property - A string representing the login method of the user. One of biometrics, device_passcode, remember_me, password, unknown
   */
  #applyAuthenticationUserProperty = async (
    property: AUTHENTICATION_TYPE,
  ): Promise<void> => {
    if (!this.#metametricsId) {
      this.#metametricsId = await this.#getMetaMetricsId();
    }
    switch (property) {
      case AUTHENTICATION_TYPE.BIOMETRIC:
        this.#identify({
          'Authentication Type': AUTHENTICATION_TYPE.BIOMETRIC,
        });
        break;
      case AUTHENTICATION_TYPE.PASSCODE:
        this.#identify({
          'Authentication Type': AUTHENTICATION_TYPE.PASSCODE,
        });
        break;
      case AUTHENTICATION_TYPE.REMEMBER_ME:
        this.#identify({
          'Authentication Type': AUTHENTICATION_TYPE.REMEMBER_ME,
        });
        break;
      case AUTHENTICATION_TYPE.PASSWORD:
        this.#identify({
          'Authentication Type': AUTHENTICATION_TYPE.PASSWORD,
        });
        break;
      default:
        this.#identify({
          'Authentication Type': AUTHENTICATION_TYPE.UNKNOWN,
        });
    }
  };

  // PUBLIC METHODS

  /**
   * Method to create or get instance of MetaMetrics.
   * @returns instance of MetaMetrics.
   */
  public static getInstance(): IMetaMetrics {
    if (!MetaMetrics.#instance) {
      // This central client manages all the tracking events
      const segmentClient = createClient({
        writeKey: (__DEV__
          ? process.env.SEGMENT_DEV_KEY
          : process.env.SEGMENT_PROD_KEY) as string,
        debug: __DEV__,
      });
      MetaMetrics.#instance = new MetaMetrics(segmentClient);
    }
    return MetaMetrics.#instance;
  }

  public enable(): void {
    this.#state = States.enabled;
    this.#setMetricsPreference();
  }

  public disable(): void {
    this.#state = States.disabled;
    this.#setMetricsPreference();
  }

  public checkEnabled(): boolean {
    return this.#state === States.enabled;
  }

  public state(): States {
    return this.#state;
  }

  public addTraitsToUser(userTraits: UserIdentityProperties): void {
    if (this.#state === States.disabled) return;
    this.#identify(userTraits);
  }

  public group(groupId: string, groupTraits?: GroupTraits): void {
    if (this.#state === States.disabled) return;
    this.#group(groupId, groupTraits);
  }

  public trackAnonymousEvent(
    event: EVENT_NAME,
    properties: JsonMap = {},
  ): void {
    if (this.#state === States.disabled) return;
    this.#trackEvent(event, true, properties);
  }

  public trackEvent(event: EVENT_NAME, properties: JsonMap = {}): void {
    if (this.#state === States.disabled) return;
    this.#trackEvent(event, false, properties);
  }

  public reset(): void {
    this.#reset();
  }

  public createDeleteRegulation(): Promise<{
    status: string;
    error?: string;
  }> {
    return this.#createDeleteRegulation();
  }

  public getDeleteRegulationId(): Promise<string> {
    return this.#getDeleteRegulationId();
  }

  public getDeleteRegulationDate(): Promise<string> {
    return this.#getDeleteRegulationDate();
  }

  public getIsDataRecorded(): boolean {
    return this.#isDataRecorded;
  }

  public getMetaMetricsId(): string {
    return this.#metametricsId;
  }

  public applyAuthenticationUserProperty(property: AUTHENTICATION_TYPE): void {
    if (this.#state === States.disabled) return;
    this.#applyAuthenticationUserProperty(property);
  }
}

export default MetaMetrics.getInstance();
