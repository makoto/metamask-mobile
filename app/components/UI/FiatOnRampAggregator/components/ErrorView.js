import React, { useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import PropTypes from 'prop-types';
import Title from '../../../Base/Title';
import { useTheme } from '../../../../util/theme';
import Text from '../../../Base/Text';
import StyledButton from '../../StyledButton';
import { strings } from '../../../../../locales/i18n';

const createStyles = (colors) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.background.default,
    },
    content: {
      width: '100%',
      paddingHorizontal: 60,
      marginTop: -100,
    },
    ctaContainer: {
      marginTop: 30,
    },
    row: {
      marginVertical: 1,
    },
    errorIcon: {
      color: colors.error.default,
      fontSize: 38,
      marginVertical: 4,
      textAlign: 'center',
    },
  });

/**
 * ErrorView is a functional general-purpose UI component responsible to show error details in Fiat On-Ramp
 *
 * @param {string} description The error description (Required)
 * @param {string} title: The error title, default will be "Error" if not provided (Optional)
 * @param {string} ctaLabel: The CTA button label, default will be "Try again" (Optional)
 * @param {func} ctaOnPress: The optional callback to be invoked when pressing the CTA button (Optional)
 *
 */
function ErrorView({ description, title, ctaLabel, ctaOnPress }) {
  const { colors } = useTheme();
  const styles = createStyles(colors);

  const ctaOnPressCallback = useCallback(() => {
    ctaOnPress();
  }, [ctaOnPress]);

  return (
    <View style={styles.screen}>
      <View style={styles.content}>
        <View style={styles.row}>
          <MaterialCommunityIcons
            name="close-circle-outline"
            style={styles.errorIcon}
          />
        </View>

        <View style={styles.row}>
          <Title centered>
            {title || strings('fiat_on_ramp_aggregator.error')}
          </Title>
        </View>

        <View style={styles.row}>
          <Text centered grey>
            {description}
          </Text>
        </View>

        {ctaOnPress && (
          <View style={styles.ctaContainer}>
            <StyledButton type="confirm" onPress={ctaOnPressCallback}>
              {ctaLabel || strings('fiat_on_ramp_aggregator.try_again')}
            </StyledButton>
          </View>
        )}
      </View>
    </View>
  );
}

ErrorView.propTypes = {
  description: PropTypes.string.isRequired,
  ctaLabel: PropTypes.string,
  ctaOnPress: PropTypes.func,
  title: PropTypes.string,
};

export default ErrorView;
