#import "AppDelegate.h"

#import <React/RCTBundleURLProvider.h>
#import <React/RCTLinkingManager.h>

// iOS 26+ SDK requires UIScene lifecycle adoption; RN 0.76 predates it.
// The window is created in didFinishLaunching (RCTAppDelegate default);
// this delegate attaches it to the window scene.
@interface SceneDelegate : UIResponder <UIWindowSceneDelegate>
@end

@implementation SceneDelegate

- (void)scene:(UIScene *)scene willConnectToSession:(UISceneSession *)session options:(UISceneConnectionOptions *)connectionOptions
{
  UIWindowScene *windowScene = (UIWindowScene *)scene;
  AppDelegate *appDelegate = (AppDelegate *)[UIApplication sharedApplication].delegate;
  // Create the window from the scene so safe-area insets (notch, status bar)
  // are correct from the start; move the RN root view controller into it.
  UIViewController *rootViewController = appDelegate.window.rootViewController;
  UIWindow *window = [[UIWindow alloc] initWithWindowScene:windowScene];
  window.rootViewController = rootViewController;
  appDelegate.window = window;
  [window makeKeyAndVisible];
  // RCTAppDelegate implements UIWindowSceneDelegate callbacks (frame/orientation changes)
  scene.delegate = appDelegate;
  // Deep-Links beim Kaltstart: RN 0.76.5 hat keine Scene-Varianten von
  // RCTLinkingManager — die URLContexts und UserActivities aus den
  // connectionOptions werden an die klassischen Methoden weitergereicht.
  for (UIOpenURLContext *context in connectionOptions.URLContexts) {
    [RCTLinkingManager application:[UIApplication sharedApplication]
                           openURL:context.URL
                           options:@{}];
  }
  for (NSUserActivity *activity in connectionOptions.userActivities) {
    [RCTLinkingManager application:[UIApplication sharedApplication]
             continueUserActivity:activity
               restorationHandler:^(NSArray<id<UIUserActivityRestoring>> * _Nullable restorableObjects) {
               }];
  }
}

@end

// Datenschutz-Overlay (P1-15): iOS erstellt den Snapshot für die App-Wechsel-
// Vorschau, bevor die JS-Seite reagieren kann — der RN-State-Wechsel auf
// LockScreen ist dafür kein gleichwertiger Ersatz. Der Overlay verdeckt den
// Inhalt daher NATIV bei jeder Deaktivierung (App-Wechsler, Kontrollzentrum,
// Benachrichtigungsansicht) — auch bei "inactive" ohne background-Wechsel —
// und wird beim wieder Aktivieren entfernt. Nur aktiv, wenn der Nutzer die
// App-Sperre eingeschaltet hat (Flag "pozume.appLock" in der App Group –
// genau wie Widget und Share-Extension lesbar).
@interface AppDelegate ()
@property (nonatomic, strong) UIView *privacyOverlay;
@end

@implementation AppDelegate

- (UISceneConfiguration *)application:(UIApplication *)application
    configurationForConnectingSceneSession:(UISceneSession *)connectingSceneSession
        options:(UISceneConnectionOptions *)options
{
  UISceneConfiguration *config = [[UISceneConfiguration alloc] initWithName:@"Pozume"
                                                                  sessionRole:connectingSceneSession.role];
  config.delegateClass = [SceneDelegate class];
  return config;
}

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  self.moduleName = @"main";

  // You can add your custom initial props in the dictionary below.
  // They will be passed down to the ViewController used by React Native.
  self.initialProps = @{};

  // Datenschutz-Overlay ein-/ausblenden (siehe Kommentar am @interface oben):
  // willResignActive feuert auch für Kontrollzentrum/Benachrichtigungsansicht,
  // also immer dann, wenn das System einen Standbild-Snapshot nehmen könnte.
  [[NSNotificationCenter defaultCenter] addObserver:self
                                           selector:@selector(handleWillResignActive:)
                                               name:UIApplicationWillResignActiveNotification
                                             object:nil];
  [[NSNotificationCenter defaultCenter] addObserver:self
                                           selector:@selector(handleDidBecomeActive:)
                                               name:UIApplicationDidBecomeActiveNotification
                                             object:nil];

  return [super application:application didFinishLaunchingWithOptions:launchOptions];
}

/** App-Sperre aktiv? Flag in der App Group – die JS-Seite schreibt es bei Boot und Toggle. */
- (BOOL)appLockEnabled
{
  NSUserDefaults *group = [[NSUserDefaults alloc] initWithSuiteName:@"group.de.inthielligent.pozume"];
  NSString *flag = [group stringForKey:@"pozume.appLock"];
  return flag != nil && [flag isEqualToString:@"1"];
}

/** Inhalt verdecken: Overlay über das Fenster legen (P1-15). */
- (void)handleWillResignActive:(NSNotification *)notification
{
  if (![self appLockEnabled]) return;
  UIWindow *window = self.window;
  if (window == nil) return;
  if (self.privacyOverlay == nil) {
    UIView *overlay = [[UIView alloc] init];
    overlay.backgroundColor = [UIColor systemBackgroundColor];
    overlay.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;

    UILabel *label = [[UILabel alloc] init];
    label.text = @"🪶 Pozume";
    label.textColor = [UIColor secondaryLabelColor];
    label.font = [UIFont boldSystemFontOfSize:22];
    label.translatesAutoresizingMaskIntoConstraints = NO;
    [overlay addSubview:label];
    [label.centerXAnchor constraintEqualToAnchor:overlay.centerXAnchor].active = YES;
    [label.centerYAnchor constraintEqualToAnchor:overlay.centerYAnchor].active = YES;

    self.privacyOverlay = overlay;
  }
  self.privacyOverlay.frame = window.bounds;
  [window addSubview:self.privacyOverlay];
}

/** Inhalt wieder freigeben: Overlay entfernen (Nachricht an nil ist erlaubt). */
- (void)handleDidBecomeActive:(NSNotification *)notification
{
  [self.privacyOverlay removeFromSuperview];
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self bundleURL];
}

- (NSURL *)bundleURL
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@".expo/.virtual-metro-entry"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

// Linking API
- (BOOL)application:(UIApplication *)application openURL:(NSURL *)url options:(NSDictionary<UIApplicationOpenURLOptionsKey,id> *)options {
  return [super application:application openURL:url options:options] || [RCTLinkingManager application:application openURL:url options:options];
}

// Deep-Links im Scene-Lifecycle (Widget-Tap, pozume://-Links): dieser Delegate
// ist zur Laufzeit auch der scene.delegate (siehe SceneDelegate oben). RN 0.76.5
// stellt keine Scene-Varianten von RCTLinkingManager bereit — die URLs werden
// an die klassische openURL:-Methode weitergereicht.
- (void)scene:(UIScene *)scene openURLContexts:(NSSet<UIOpenURLContext *> *)URLContexts
{
  for (UIOpenURLContext *context in URLContexts) {
    [RCTLinkingManager application:[UIApplication sharedApplication]
                           openURL:context.URL
                           options:@{}];
  }
}

// Universal Links im Scene-Lifecycle (analog openURLContexts).
- (void)scene:(UIScene *)scene continueUserActivity:(nonnull NSUserActivity *)userActivity
{
  [RCTLinkingManager application:[UIApplication sharedApplication]
          continueUserActivity:userActivity
            restorationHandler:^(NSArray<id<UIUserActivityRestoring>> * _Nullable restorableObjects) {
            }];
}

// Universal Links
- (BOOL)application:(UIApplication *)application continueUserActivity:(nonnull NSUserActivity *)userActivity restorationHandler:(nonnull void (^)(NSArray<id<UIUserActivityRestoring>> * _Nullable))restorationHandler {
  BOOL result = [RCTLinkingManager application:application continueUserActivity:userActivity restorationHandler:restorationHandler];
  return [super application:application continueUserActivity:userActivity restorationHandler:restorationHandler] || result;
}

// Explicitly define remote notification delegates to ensure compatibility with some third-party libraries
- (void)application:(UIApplication *)application didRegisterForRemoteNotificationsWithDeviceToken:(NSData *)deviceToken
{
  return [super application:application didRegisterForRemoteNotificationsWithDeviceToken:deviceToken];
}

// Explicitly define remote notification delegates to ensure compatibility with some third-party libraries
- (void)application:(UIApplication *)application didFailToRegisterForRemoteNotificationsWithError:(NSError *)error
{
  return [super application:application didFailToRegisterForRemoteNotificationsWithError:error];
}

// Explicitly define remote notification delegates to ensure compatibility with some third-party libraries
- (void)application:(UIApplication *)application didReceiveRemoteNotification:(NSDictionary *)userInfo fetchCompletionHandler:(void (^)(UIBackgroundFetchResult))completionHandler
{
  return [super application:application didReceiveRemoteNotification:userInfo fetchCompletionHandler:completionHandler];
}

@end
