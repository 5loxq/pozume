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

  return [super application:application didFinishLaunchingWithOptions:launchOptions];
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
